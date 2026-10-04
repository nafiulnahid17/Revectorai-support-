import manifest from "./security-manifest.json" with { type: "json" };
import { configuration, failure, ControlError } from "./control/db.js";
import { authenticate } from "./control/auth.js";
import { controlRoute } from "./control/routes.js";
const pages = new Set([
  "/admin",
  "/admin/overview",
  "/admin/users",
  "/admin/wallets",
  "/admin/credits",
  "/admin/usage",
  "/admin/models",
  "/admin/support",
  "/admin/audit",
  "/admin/settings",
]);
const mutations = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const apiRoutes = new Map([
  ["/api/admin/auth/login", "POST"],
  ["/api/admin/auth/logout", "POST"],
  ...[
    "session",
    "overview",
    "users",
    "wallets",
    "transactions",
    "usage",
    "requests",
    "audit",
    "models",
    "settings",
    "support",
    "support/messages",
  ].map((r) => ["/api/admin/" + r, "GET"]),
  ...[
    "wallet/adjust",
    "requests/decide",
    "users/status",
    "support/reply",
    "models/update",
  ].map((r) => ["/api/admin/" + r, "POST"]),
]);
function decorate(response, extraCookie) {
  const headers = new Headers(response.headers);
  headers.delete("server");
  headers.delete("access-control-allow-origin");
  headers.delete("access-control-allow-credentials");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "same-origin");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  headers.set(
    "Content-Security-Policy",
    `default-src 'self'; script-src 'self' 'sha256-${manifest.scriptHash}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`,
  );
  if (extraCookie) headers.append("Set-Cookie", extraCookie);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
export async function handle(request, env, transport = fetch) {
  const url = new URL(request.url),
    path = url.pathname;
  const reject = () =>
    decorate(
      failure(
        new ControlError(
          "ROUTE_NOT_ALLOWED",
          404,
          "This endpoint is unavailable.",
        ),
      ),
    );
  if (
    (path.startsWith("/api/") &&
      request.headers.get("sec-fetch-site") === "cross-site") ||
    (mutations.has(request.method) &&
      request.headers.get("origin") !== url.origin)
  )
    return decorate(failure(new ControlError("ORIGIN_REJECTED", 403)));
  if (path === "/health" && request.method === "GET")
    return decorate(
      Response.json({ status: "ok", service: "ReVector Admin / Support" }),
    );
  if (path === "/api/admin/bootstrap" && request.method === "GET") {
    let configured = false;
    try {
      configuration(env);
      configured = true;
    } catch {}
    return decorate(Response.json({ configured }));
  }
  if (path.startsWith("/api/")) {
    if (apiRoutes.get(path) !== request.method) return reject();
    try {
      return decorate(await controlRoute(request, env, transport));
    } catch (error) {
      return decorate(failure(error));
    }
  }
  if (request.method !== "GET" && request.method !== "HEAD") return reject();
  if (path === "/")
    return decorate(Response.redirect(url.origin + "/admin/login", 302));
  if (path === "/admin/login")
    return decorate(
      await env.ASSETS.fetch(new Request(url.origin + "/index.html", request)),
    );
  if (path.startsWith("/assets/") && !/%(?:2f|5c|00)/i.test(path))
    return decorate(await env.ASSETS.fetch(request));
  if (!pages.has(path)) return reject();
  let identity;
  try {
    identity = await authenticate(request, env, transport, true);
  } catch {
    return decorate(Response.redirect(url.origin + "/admin/login", 302));
  }
  if (identity.profile.role === "SUPPORT" && path !== "/admin/support")
    return decorate(
      Response.redirect(url.origin + "/admin/support", 302),
      identity.cookie,
    );
  return decorate(
    await env.ASSETS.fetch(new Request(url.origin + "/index.html", request)),
    identity.cookie,
  );
}
export default {
  fetch(request, env) {
    return handle(request, env);
  },
};
