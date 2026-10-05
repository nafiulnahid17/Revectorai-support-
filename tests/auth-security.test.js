/** Test-only Auth/PostgREST transport. SQL/RLS is verified independently with real PostgreSQL. */
import test from "node:test";
import assert from "node:assert/strict";
import { handle } from "../worker/index.js";
import { seal } from "../worker/control/auth.js";
const U = "00000000-0000-4000-8000-000000000002",
  A = "00000000-0000-4000-8000-000000000001",
  P = "10000000-0000-4000-8000-000000000001";
const env = {
  SESSION_SIGNING_KEY: "test-session-" + "s".repeat(40),
  SUPABASE_URL: "https://database.example",
  SUPABASE_ANON_KEY: "test-only-anon",
  SUPABASE_SERVICE_ROLE_KEY: "test-only-service",
};
const req = (path, method = "GET", body, extra = {}) =>
  new Request("https://web.example" + path, {
    method,
    headers: {
      origin: "https://web.example",
      "content-type": "application/json",
      ...extra,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
function fixture() {
  const profiles = {
    [U]: {
      id: U,
      auth_user_id: U,
      email: "user@example.test",
      role: "USER",
      status: "ACTIVE",
    },
    [A]: {
      id: A,
      auth_user_id: A,
      email: "admin@example.test",
      role: "ADMIN",
      status: "ACTIVE",
    },
  };
  const calls = [];
  async function transport(request) {
    const u = new URL(request.url);
    calls.push({
      url: u,
      headers: request.headers,
      method: request.method,
      body: request.method === "GET" ? null : await request.clone().json(),
    });
    if (u.hostname === "engine.example")
      return Response.json({ project_id: P, job_id: P, status: "queued" });
    if (u.pathname === "/auth/v1/token") {
      const d = await request.json(),
        id = d.email === "admin@example.test" ? A : U;
      return Response.json({
        access_token: "access-" + id,
        refresh_token: "refresh-" + id,
        expires_in: 3600,
        user: { id },
      });
    }
    if (u.pathname === "/auth/v1/user") {
      const id = request.headers
        .get("Authorization")
        .slice("Bearer access-".length);
      return Response.json({ id, user_metadata: { role: "ADMIN" } });
    }
    if (u.pathname === "/rest/v1/revector_profiles")
      return Response.json([profiles[u.searchParams.get("id").slice(3)]]);
    if (u.pathname === "/rest/v1/rpc/rv_admin_overview")
      return Response.json({ total_users: 2 });
    if (u.pathname === "/rest/v1/rpc/rv_reserve_operation")
      return Response.json({ id: P, replayed: false, reserved_credits: 0 });
    if (u.pathname.startsWith("/rest/v1/rpc/")) return Response.json({});
    return Response.json([]);
  }
  return { transport, profiles, calls };
}
async function login(f, admin = false) {
  const r = admin
    ? await handle(
        req("/api/admin/auth/login", "POST", {
          email: admin ? "admin@example.test" : "user@example.test",
          password: "test-only-password",
        }),
        env,
        f.transport,
      )
    : new Response("{}", {
        headers: {
          "Set-Cookie": (
            await seal(new Request("https://user.example/"), env, false, {
              access: "access-" + U,
              refresh: "test-refresh",
              expires: Date.now() / 1000 + 3600,
              created: Date.now() / 1000,
            })
          ).replace("revector_admin_auth", "revector_user_auth"),
        },
      });
  assert.equal(r.status, 200);
  const data = await r.json();
  assert.ok(!JSON.stringify(data).includes("access-"));
  return r.headers.get("set-cookie").split(";")[0];
}
test("dedicated admin login/cookie cannot be granted by user session or forged metadata", async () => {
  const f = fixture(),
    cookie = await login(f);
  const response = await handle(
    req("/api/admin/overview", "GET", undefined, { cookie }),
    env,
    f.transport,
  );
  assert.equal(response.status, 401);
  assert.equal(
    (
      await handle(
        req("/api/admin/auth/login", "POST", {
          email: "user@example.test",
          password: "test-only-password",
        }),
        env,
        f.transport,
      )
    ).status,
    403,
  );
  const copied = cookie.replace("revector_user_auth", "revector_admin_auth");
  assert.equal(
    (
      await handle(
        req("/api/admin/overview", "GET", undefined, { cookie: copied }),
        env,
        f.transport,
      )
    ).status,
    401,
  );
  const adminCookie = await login(f, true);
  assert.equal(
    (
      await handle(
        req("/api/admin/overview", "GET", undefined, { cookie: adminCookie }),
        env,
        f.transport,
      )
    ).status,
    200,
  );
  f.profiles[A].role = "USER";
  assert.equal(
    (
      await handle(
        req("/api/admin/overview", "GET", undefined, { cookie: adminCookie }),
        env,
        f.transport,
      )
    ).status,
    403,
  );
});

test("SUPPORT session can read/reply to tickets but cannot access financial or global APIs", async () => {
  const f = fixture();
  f.profiles[A].role = "SUPPORT";
  const cookie = await login(f, true);
  for (const path of [
    "/api/admin/users",
    "/api/admin/wallets",
    "/api/admin/audit",
    "/api/admin/usage",
    "/api/admin/settings",
  ]) {
    assert.equal(
      (await handle(req(path, "GET", undefined, { cookie }), env, f.transport))
        .status,
      403,
      path,
    );
  }
  assert.equal(
    (
      await handle(
        req("/api/admin/wallet/adjust", "POST", {}, { cookie }),
        env,
        f.transport,
      )
    ).status,
    403,
  );
  assert.equal(
    (
      await handle(
        req("/api/admin/support", "GET", undefined, { cookie }),
        env,
        f.transport,
      )
    ).status,
    200,
  );
  const response = await handle(
    req(
      "/api/admin/support/reply",
      "POST",
      { request_id: P, message: "Review the contour.", status: "IN_PROGRESS" },
      { cookie },
    ),
    env,
    f.transport,
  );
  assert.equal(response.status, 200);
  const rpc = f.calls.find(
    (c) => c.url.pathname === "/rest/v1/rpc/rv_reply_support",
  );
  assert.equal(rpc.body.p_admin, A);
});
test("Admin sessions are origin-bound, revoked profiles fail and ledger actions retain validated idempotency", async () => {
  const f = fixture(),
    cookie = await login(f, true);
  const wrong = new Request("https://different-admin.example/api/admin/users", {
    headers: { cookie },
  });
  assert.equal((await handle(wrong, env, f.transport)).status, 401);
  const key = crypto.randomUUID();
  const adjustment = await handle(
    req(
      "/api/admin/wallet/adjust",
      "POST",
      {
        user_id: U,
        delta: -2,
        reason: "Documented correction",
        idempotency_key: key,
      },
      { cookie },
    ),
    env,
    f.transport,
  );
  assert.equal(adjustment.status, 200);
  const rpc = f.calls.find(
    (c) => c.url.pathname === "/rest/v1/rpc/rv_adjust_wallet",
  );
  assert.equal(rpc.body.p_admin, A);
  assert.equal(rpc.body.p_key, key);
  assert.equal(rpc.body.p_delta, -2);
  const invalid = await handle(
    req(
      "/api/admin/wallet/adjust",
      "POST",
      { user_id: U, delta: -2, reason: "", idempotency_key: key },
      { cookie },
    ),
    env,
    f.transport,
  );
  assert.equal(invalid.status, 400);

  const payment = await handle(
    req(
      "/api/admin/settings/payment",
      "POST",
      {
        usd_to_bdt_rate: 130,
        bkash: {
          enabled: true,
          number: "01700000000",
          instructions: ["Send payment", "Keep the transaction ID"],
        },
        nagad: {
          enabled: false,
          number: "",
          instructions: [],
        },
      },
      { cookie },
    ),
    env,
    f.transport,
  );
  assert.equal(payment.status, 200);
  const paymentRpc = f.calls.find(
    (c) => c.url.pathname === "/rest/v1/rpc/rv_update_payment_settings",
  );
  assert.equal(paymentRpc.body.p_admin, A);
  assert.equal(paymentRpc.body.p_rate, 130);
  f.profiles[A].status = "SUSPENDED";
  assert.equal(
    (
      await handle(
        req("/api/admin/users", "GET", undefined, { cookie }),
        env,
        f.transport,
      )
    ).status,
    403,
  );
});
