import { input, uuid, text, number, ControlError } from "./db.js";
import { authenticate, authRoute } from "./auth.js";
const adminTables = {
  users: "revector_profiles",
  wallets: "revector_wallets",
  transactions: "revector_wallet_transactions",
  usage: "revector_usage_events",
  requests: "revector_requests",
  audit: "revector_admin_audit_log",
  models: "revector_model_catalog",
};
function page(url) {
  const n = Number(url.searchParams.get("offset") || 0);
  if (!Number.isInteger(n) || n < 0 || n > 100000)
    throw new ControlError("INVALID_PAGE");
  return { limit: "50", offset: String(n) };
}

const paymentMethods = new Set([
  "BKASH",
  "NAGAD",
  "BANK_TRANSFER",
  "CARD",
  "CASH",
  "MANUAL",
  "OTHER",
]);

function dashboardSeries(rows, requests, transactions, profiles) {
  const days = [];
  const byDay = new Map();
  const now = new Date();
  for (let offset = 29; offset >= 0; offset--) {
    const d = new Date(Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate() - offset,
    ));
    const key = d.toISOString().slice(0, 10);
    const item = {
      day: key,
      usage_events: 0,
      credits_used: 0,
      ai_cost_usd: 0,
      failed_events: 0,
      new_users: 0,
      wallet_credits: 0,
    };
    days.push(item);
    byDay.set(key, item);
  }
  const bucket = (value) => byDay.get(String(value || "").slice(0, 10));
  for (const row of rows || []) {
    const day = bucket(row.created_at);
    if (!day) continue;
    day.usage_events += 1;
    day.credits_used += Number(row.credits_charged || 0);
    day.ai_cost_usd += Number(row.estimated_usd_cost || 0);
    if (row.status === "FAILED") day.failed_events += 1;
  }
  for (const row of profiles || []) {
    const day = bucket(row.created_at);
    if (day) day.new_users += 1;
  }
  for (const row of transactions || []) {
    const day = bucket(row.created_at);
    if (day && Number(row.credits_delta || 0) > 0)
      day.wallet_credits += Number(row.credits_delta || 0);
  }
  const support = { OPEN: 0, IN_PROGRESS: 0, RESOLVED: 0, CLOSED: 0 };
  const requestsByType = { TOPUP: 0, MODEL_CHANGE: 0, SUPPORT: 0 };
  for (const row of requests || []) {
    if (row.type in requestsByType) requestsByType[row.type] += 1;
    if (row.type === "SUPPORT" && row.status in support)
      support[row.status] += 1;
  }
  return { daily: days, support, requests: requestsByType };
}
export async function controlRoute(request, env, transport) {
  const url = new URL(request.url),
    path = url.pathname;
  if (!path.startsWith("/api/admin/"))
    throw new ControlError("ROUTE_NOT_ALLOWED", 404);
  if (path.startsWith("/api/admin/auth/"))
    return authRoute(request, env, transport, true);
  const identity = await authenticate(request, env, transport, true);
  const db = identity.db,
    uid = identity.user.id;
  const response = (data) =>
    Response.json(data, {
      headers: identity.cookie ? { "Set-Cookie": identity.cookie } : {},
    });
  {
    const route = path.slice("/api/admin/".length);
    if (
      identity.profile.role === "SUPPORT" &&
      !["session", "support", "support/reply", "support/messages"].includes(
        route,
      )
    )
      throw new ControlError(
        "ADMIN_REQUIRED",
        403,
        "This action requires an administrator.",
      );
    if (route === "session" && request.method === "GET")
      return response({ profile: identity.profile });
    if (route === "overview" && request.method === "GET") {
      const since = new Date(Date.now() - 29 * 86400000).toISOString();
      const [summary, usage, requests, transactions, profiles] =
        await Promise.all([
          db.rpc("rv_admin_overview", { p_admin: uid }),
          db.table("revector_usage_events", {
            select:
              "created_at,status,credits_charged,estimated_usd_cost,cost_source",
            event_key: "not.like.request:*",
            created_at: "gte." + since,
            order: "created_at.asc",
            limit: "1000",
          }),
          db.table("revector_requests", {
            select: "created_at,type,status",
            created_at: "gte." + since,
            order: "created_at.asc",
            limit: "1000",
          }),
          db.table("revector_wallet_transactions", {
            select: "created_at,credits_delta,type",
            created_at: "gte." + since,
            order: "created_at.asc",
            limit: "1000",
          }),
          db.table("revector_profiles", {
            select: "created_at",
            created_at: "gte." + since,
            order: "created_at.asc",
            limit: "1000",
          }),
        ]);
      return response({
        ...summary,
        charts: dashboardSeries(usage, requests, transactions, profiles),
        chart_window_days: 30,
      });
    }
    if (route === "settings" && request.method === "GET")
      return response({
        credits_per_usd: env.CREDITS_PER_USD
          ? Number(env.CREDITS_PER_USD)
          : null,
        payments: "MANUAL_REQUESTS",
        authentication: "INVITE_ONLY",
        model_preferences: "ADVISORY",
        engine_configuration: "READ_ONLY",
      });
    if (route === "support" && request.method === "GET")
      return response({
        items: await db.table("revector_requests", {
          type: "eq.SUPPORT",
          select:
            "*,revector_profiles!revector_requests_user_id_fkey(name,email)",
          order: "updated_at.desc",
          ...page(url),
        }),
      });
    if (route in adminTables && request.method === "GET") {
      const query = { select: route === "usage" ? "*" : "*", ...page(url) };
      if (route === "usage") query.event_key = "not.like.request:*";
      if (!["models", "wallets"].includes(route))
        query.order = "created_at.desc";
      if (route === "requests" && url.searchParams.has("type")) {
        const type = url.searchParams.get("type");
        if (!["TOPUP", "MODEL_CHANGE", "SUPPORT"].includes(type))
          throw new ControlError("INVALID_TYPE");
        query.type = "eq." + type;
      }
      return response({ items: await db.table(adminTables[route], query) });
    }
    if (route === "wallet/adjust" && request.method === "POST") {
      const d = await input(request);
      let delta;
      let reason;
      if (d.credits !== undefined) {
        const direction = text(d.direction, 12);
        if (!["ADD", "DEDUCT"].includes(direction))
          throw new ControlError("INVALID_DIRECTION");
        const credits = number(Number(d.credits), 0.0001, 1e6);
        const method = text(d.payment_method, 40);
        if (!paymentMethods.has(method))
          throw new ControlError("INVALID_PAYMENT_METHOD");
        const reference = text(d.transaction_reference, 180);
        const note = text(d.note || "", 600, false);
        delta = direction === "ADD" ? credits : -credits;
        const action =
          direction === "ADD" ? "Credit recharge" : "Balance deduction";
        reason =
          action +
          " | Method: " +
          method.replaceAll("_", " ") +
          " | Transaction: " +
          reference +
          (note ? " | Note: " + note : "");
      } else {
        delta = number(d.delta, -1e6, 1e6);
        reason = text(d.reason);
      }
      return response(
        await db.rpc("rv_adjust_wallet", {
          p_admin: uid,
          p_user: uuid(d.user_id),
          p_delta: delta,
          p_reason: reason,
          p_key: uuid(d.idempotency_key),
        }),
      );
    }
    if (route === "requests/decide" && request.method === "POST") {
      const d = await input(request);
      if (d.decision === "REPLY")
        return response(
          await db.rpc("rv_reply_request", {
            p_admin: uid,
            p_request: uuid(d.request_id),
            p_response: text(d.response, 4000),
          }),
        );
      if (!["APPROVED", "REJECTED"].includes(d.decision))
        throw new ControlError("INVALID_DECISION");
      return response(
        await db.rpc("rv_decide_request", {
          p_admin: uid,
          p_request: uuid(d.request_id),
          p_decision: d.decision,
          p_response: text(d.response || "", 4000, false),
          p_key: uuid(d.idempotency_key),
          p_model: d.model_id ? uuid(d.model_id) : null,
        }),
      );
    }
    if (route === "users/status" && request.method === "POST") {
      const d = await input(request);
      if (!["ACTIVE", "SUSPENDED", "DISABLED"].includes(d.status))
        throw new ControlError("INVALID_STATUS");
      return response(
        await db.rpc("rv_set_account_status", {
          p_admin: uid,
          p_user: uuid(d.user_id),
          p_status: d.status,
          p_reason: text(d.reason),
        }),
      );
    }
    if (route === "support/reply" && request.method === "POST") {
      const d = await input(request);
      return response(
        await db.rpc("rv_reply_support", {
          p_admin: uid,
          p_request: uuid(d.request_id),
          p_response: text(d.message, 4000),
          p_status: text(d.status, 30),
        }),
      );
    }
    if (route === "support/messages" && request.method === "GET") {
      const ticket = uuid(url.searchParams.get("request_id"));
      const found = (
        await db.table("revector_requests", {
          id: "eq." + ticket,
          type: "eq.SUPPORT",
          select: "id",
        })
      )[0];
      if (!found) throw new ControlError("NOT_FOUND", 404);
      return response({
        items: await db.table("revector_support_messages", {
          request_id: "eq." + ticket,
          select: "*",
          order: "created_at.asc",
          ...page(url),
        }),
      });
    }
    if (route === "models/update" && request.method === "POST") {
      const d = await input(request);
      if (
        typeof d.enabled !== "boolean" ||
        !d.operation_prices ||
        Array.isArray(d.operation_prices) ||
        Object.keys(d.operation_prices).length > 6
      )
        throw new ControlError("INVALID_PRICING");
      return response(
        await db.rpc("rv_update_catalog", {
          p_admin: uid,
          p_id: uuid(d.model_id),
          p_enabled: d.enabled,
          p_prices: d.operation_prices,
          p_version: text(d.pricing_version, 80),
          p_reason: text(d.reason),
        }),
      );
    }
    throw new ControlError("ROUTE_NOT_ALLOWED", 404);
  }
}
