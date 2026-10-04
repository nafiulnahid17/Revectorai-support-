import { configuration, database, ControlError, input, text } from "./db.js";
const encoder = new TextEncoder();
const lifetime = 7 * 24 * 3600;
const name = () => "revector_admin_auth";
const b64 = (b) =>
  btoa(String.fromCharCode(...new Uint8Array(b)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
const unb64 = (s) =>
  Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) =>
    c.charCodeAt(0),
  );
async function key(env) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(env.SESSION_SIGNING_KEY),
  );
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, [
    "encrypt",
    "decrypt",
  ]);
}
function cookie(request, admin, value, age = lifetime) {
  return `${name(admin)}=${value}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${age}${new URL(request.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function seal(request, env, admin, payload) {
  configuration(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv,
      additionalData: encoder.encode(new URL(request.url).origin + name(admin)),
    },
    await key(env),
    encoder.encode(JSON.stringify(payload)),
  );
  return cookie(request, admin, b64(iv) + "." + b64(data));
}
async function open(request, env, admin) {
  configuration(env);
  const value = request.headers
    .get("cookie")
    ?.split(";")
    .map((v) => v.trim())
    .find((v) => v.startsWith(name(admin) + "="))
    ?.slice(name(admin).length + 1);
  if (!value || value.length > 16000) return null;
  try {
    const [iv, data] = value.split(".");
    const clear = await crypto.subtle.decrypt(
      {
        name: "AES-GCM",
        iv: unb64(iv),
        additionalData: encoder.encode(
          new URL(request.url).origin + name(admin),
        ),
      },
      await key(env),
      unb64(data),
    );
    const p = JSON.parse(new TextDecoder().decode(clear));
    if (Date.now() / 1000 - p.created > lifetime) return null;
    return p;
  } catch {
    return null;
  }
}
export async function authenticate(request, env, transport, admin = true) {
  if (!admin) throw new ControlError("ROUTE_NOT_ALLOWED", 404);
  const payload = await open(request, env, admin);
  if (!payload)
    throw new ControlError(
      admin ? "ADMIN_LOGIN_REQUIRED" : "LOGIN_REQUIRED",
      401,
      "Sign in to continue.",
    );
  const db = database(env, transport);
  let { access, refresh, expires, created } = payload;
  let setCookie;
  if (expires < Date.now() / 1000 + 30) {
    const r = await db.call("/auth/v1/token?grant_type=refresh_token", {
      method: "POST",
      auth: true,
      body: { refresh_token: refresh },
    });
    access = r.access_token;
    refresh = r.refresh_token;
    expires = Date.now() / 1000 + r.expires_in;
    setCookie = await seal(request, env, admin, {
      access,
      refresh,
      expires,
      created,
    });
  }
  const user = await db.call("/auth/v1/user", { auth: true, token: access });
  const profile = (
    await db.table("revector_profiles", {
      id: "eq." + user.id,
      select: "*",
      limit: "1",
    })
  )[0];
  if (
    !profile ||
    profile.auth_user_id !== user.id ||
    profile.status !== "ACTIVE" ||
    (profile.sessions_valid_after &&
      created * 1000 <= Date.parse(profile.sessions_valid_after))
  )
    throw new ControlError(
      "ACCOUNT_NOT_ACTIVE",
      403,
      "This account cannot access ReVector.",
    );
  if (admin && !["ADMIN", "SUPPORT"].includes(profile.role))
    throw new ControlError(
      "ADMIN_REQUIRED",
      403,
      "This account is not authorized for the Support Console.",
    );
  return {
    user,
    profile,
    access,
    created,
    cookie: setCookie,
    principal: "user_" + user.id,
    db,
  };
}
export async function authRoute(request, env, transport, admin = true) {
  if (!admin) throw new ControlError("ROUTE_NOT_ALLOWED", 404);
  const path = new URL(request.url).pathname;
  const db = database(env, transport);
  if (path.endsWith("/login") && request.method === "POST") {
    const data = await input(request);
    const email = text(data.email, 254),
      password = text(data.password, 200);
    const tokens = await db.call("/auth/v1/token?grant_type=password", {
      method: "POST",
      auth: true,
      body: { email, password },
    });
    const profile = (
      await db.table("revector_profiles", {
        id: "eq." + tokens.user.id,
        select: "*",
        limit: "1",
      })
    )[0];
    if (
      !profile ||
      profile.auth_user_id !== tokens.user.id ||
      profile.status !== "ACTIVE"
    )
      throw new ControlError(
        "ACCOUNT_NOT_ACTIVE",
        403,
        "An active ReVector invitation is required.",
      );
    if (admin && !["ADMIN", "SUPPORT"].includes(profile.role))
      throw new ControlError(
        "ADMIN_REQUIRED",
        403,
        "This account is not authorized for the Support Console.",
      );
    const created = Date.now() / 1000;
    const setCookie = await seal(request, env, admin, {
      access: tokens.access_token,
      refresh: tokens.refresh_token,
      expires: created + tokens.expires_in,
      created,
    });
    return Response.json({ profile }, { headers: { "Set-Cookie": setCookie } });
  }
  const identity = await authenticate(request, env, transport, admin);
  if (path.endsWith("/logout") && request.method === "POST") {
    await db.call("/auth/v1/logout?scope=global", {
      method: "POST",
      auth: true,
      token: identity.access,
    });
    await db.table(
      "revector_profiles",
      { id: "eq." + identity.user.id },
      {
        method: "PATCH",
        body: { sessions_valid_after: new Date().toISOString() },
      },
    );
    const headers = new Headers();
    headers.append("Set-Cookie", cookie(request, true, "", 0));
    return Response.json({ signed_out: true }, { headers });
  }
  throw new ControlError("ROUTE_NOT_ALLOWED", 404);
}
