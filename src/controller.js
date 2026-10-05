import { account, currentPath, accountPage } from "./model.js";
let redraw = () => {};
export function registerRenderer(renderer) {
  redraw = renderer;
}
export async function request(path, method = "GET", body) {
  let response;
  try {
    response = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(12000),
    });
  } catch {
    throw new Error(
      navigator.onLine
        ? "Operations service could not be reached. Retry when connected."
        : "No internet connection. Changes have not been submitted.",
    );
  }
  const raw = await response.text();
  if (raw.length > 1024 * 1024)
    throw new Error("Operations response is too large.");
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("Operations service returned an invalid response.");
  }
  if (!response.ok)
    throw Object.assign(
      new Error(data.error?.message || "Operations request failed."),
      { status: response.status },
    );
  return data;
}
async function guarded(work) {
  if (account.busy) return;
  account.busy = true;
  account.error = "";
  redraw();
  try {
    return await work();
  } catch (error) {
    account.error = error.message;
    if (error.status === 401) {
      account.adminProfile = null;
      history.replaceState({}, "", "/admin/login");
    }
  } finally {
    account.busy = false;
    redraw();
  }
}
async function load() {
  const page = accountPage();
  if (page === "admin-login" || !account.adminProfile) return;
  if (account.adminProfile.role === "SUPPORT" && page !== "support") {
    history.replaceState({}, "", "/admin/support");
  }
  const route = accountPage(),
    offset = "?offset=" + account.offset;
  if (route === "settings") {
    const [settings, models] = await Promise.all([
      request("/api/admin/settings"),
      request("/api/admin/models"),
    ]);
    account.data = { settings, catalog: models.items };
  } else if (route === "wallets") {
    const [wallets, transactions] = await Promise.all([
      request("/api/admin/wallets" + offset),
      request("/api/admin/transactions" + offset),
    ]);
    account.data = {
      items: wallets.items,
      transactions: transactions.items,
    };
  } else if (["credits", "models"].includes(route)) {
    const [requests, models] = await Promise.all([
      request(
        "/api/admin/requests" +
          offset +
          "&type=" +
          (route === "credits" ? "TOPUP" : "MODEL_CHANGE"),
      ),
      request("/api/admin/models"),
    ]);
    account.data = { items: requests.items, catalog: models.items };
  } else account.data = await request("/api/admin/" + route + offset);
}
export async function initialize() {
  await guarded(async () => {
    account.configured = (await request("/api/admin/bootstrap")).configured;
    if (!account.configured) return;
    if (currentPath() !== "/admin/login")
      account.adminProfile = (await request("/api/admin/session")).profile;
    await load();
  });
}
export async function navigate(path) {
  if (!/^\/admin(?:\/[a-z-]+)?$/.test(path) || account.busy) return;
  history.pushState({}, "", path);
  account.notice = "";
  account.ticket = null;
  account.editUser = null;
  account.editModel = null;
  account.offset = 0;
  account.data = {};
  await guarded(load);
}
export async function click(target) {
  if (account.busy) return;
  const action = target.dataset.account;
  if (action === "nav")
    return navigate(new URL(target.href, location.origin).pathname);
  if (action === "refresh") return guarded(load);
  if (action === "next" || action === "previous") {
    account.offset = Math.max(
      0,
      account.offset + (action === "next" ? 50 : -50),
    );
    return guarded(load);
  }
  if (action === "admin-logout")
    return guarded(async () => {
      await request("/api/admin/auth/logout", "POST", {});
      location.assign("/admin/login");
    });
  if (action === "close-ticket") {
    account.ticket = null;
    account.messages = [];
    redraw();
    return;
  }
  if (action === "edit-wallet" || action === "edit-status") {
    account.editUser = target.dataset.id;
    redraw();
    return;
  }
  if (action === "edit-model") {
    account.editModel = account.data.catalog.find(
      (m) => m.id === target.dataset.id,
    );
    redraw();
    return;
  }
  if (action === "review-request") {
    account.ticket = account.data.items.find((r) => r.id === target.dataset.id);
    redraw();
    return;
  }
  if (action === "ticket")
    return guarded(async () => {
      account.ticket = account.data.items.find(
        (r) => r.id === target.dataset.id,
      );
      account.messages = (
        await request(
          "/api/admin/support/messages?request_id=" +
            encodeURIComponent(target.dataset.id),
        )
      ).items;
    });
}
const keys = new Map();
function idempotency(type, data) {
  const fingerprint = JSON.stringify(data),
    old = keys.get(type);
  if (old?.fingerprint === fingerprint) return old.key;
  const key = crypto.randomUUID();
  keys.set(type, { fingerprint, key });
  return key;
}
export async function submit(form) {
  if (account.busy) return;
  const type = form.dataset.accountForm,
    data = Object.fromEntries(new FormData(form));
  await guarded(async () => {
    if (type === "admin-login") {
      account.adminProfile = (
        await request("/api/admin/auth/login", "POST", data)
      ).profile;
      history.replaceState(
        {},
        "",
        account.adminProfile.role === "SUPPORT" ? "/admin/support" : "/admin",
      );
      await load();
      return;
    }
    const routes = {
      "support-reply": "support/reply",
      adjust: "wallet/adjust",
      decision: "requests/decide",
      status: "users/status",
      catalog: "models/update",
      "payment-settings": "settings/payment",
    };
    if (!routes[type]) throw new Error("This action is unavailable.");
    if (type === "adjust") {
      if (data.credits !== undefined) data.credits = Number(data.credits);
      else data.delta = Number(data.delta);
      data.idempotency_key = idempotency(type, data);
    }
    if (type === "decision") data.idempotency_key = idempotency(type, data);
    if (type === "catalog") {
      try {
        data.operation_prices = JSON.parse(data.operation_prices);
      } catch {
        throw new Error("Enter a valid operation-prices JSON object.");
      }
      data.enabled = data.enabled === "true";
    }
    if (type === "payment-settings") {
      const instructions = (value) =>
        String(value || "")
          .split("\n")
          .map((item) => item.trim())
          .filter(Boolean);
      data.usd_to_bdt_rate = Number(data.usd_to_bdt_rate);
      data.bkash = {
        enabled: data.bkash_enabled === "true",
        number: String(data.bkash_number || "").trim(),
        instructions: instructions(data.bkash_instructions),
      };
      data.nagad = {
        enabled: data.nagad_enabled === "true",
        number: String(data.nagad_number || "").trim(),
        instructions: instructions(data.nagad_instructions),
      };
      delete data.bkash_enabled;
      delete data.bkash_number;
      delete data.bkash_instructions;
      delete data.nagad_enabled;
      delete data.nagad_number;
      delete data.nagad_instructions;
    }
    await request("/api/admin/" + routes[type], "POST", data);
    keys.delete(type);
    account.notice = "Saved successfully.";
    account.ticket = null;
    account.editUser = null;
    account.editModel = null;
    await load();
  });
}
export async function restoreRoute() {
  if (!account.busy) await guarded(load);
}
