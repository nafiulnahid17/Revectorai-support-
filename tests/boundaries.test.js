import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { handle } from "../worker/index.js";
const url = "https://admin.example";
test("standalone Admin build has no production workspace and matches CSP", async () => {
  const html = await readFile("public/index.html", "utf8"),
    manifest = JSON.parse(
      await readFile("worker/security-manifest.json", "utf8"),
    );
  assert.ok(html.includes("Admin Sign In"));
  assert.ok(html.includes("Support & Operations Console"));
  for (const marker of [
    "/api/revector/",
    "/api/account/",
    'data-action="new-project"',
    "Upload Artwork",
    "ENGINE_API_KEY",
  ])
    assert.ok(!html.includes(marker), marker);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  assert.equal(
    createHash("sha256").update(scripts[0][1]).digest("base64"),
    manifest.scriptHash,
  );
});
test("Admin Worker denies user/engine routes, asset aliases and unknown actions before transport", async () => {
  const never = () => assert.fail("Forbidden route called transport");
  for (const path of [
    "/api/account/wallet",
    "/api/auth/login",
    "/api/revector/projects",
    "/api/admin/delete",
    "/index.html",
    "/admin-login.html",
  ]) {
    const r = await handle(
      new Request(url + path),
      { ASSETS: { fetch: never } },
      never,
    );
    assert.equal(r.status, 404, path);
  }
  const r = await handle(
    new Request(url + "/api/admin/wallet/adjust", {
      method: "POST",
      headers: { origin: "https://user.example" },
      body: "{}",
    }),
    {},
    never,
  );
  assert.equal(r.status, 403);
});
test("Admin login is public, protected console redirects before asset fetch, configuration failure is honest", async () => {
  const assets = { fetch: async (r) => new Response(new URL(r.url).pathname) },
    env = { ASSETS: assets };
  const login = await handle(new Request(url + "/admin/login"), env);
  assert.equal(login.status, 200);
  assert.equal(await login.text(), "/index.html");
  const externalNavigation = await handle(
    new Request(url + "/admin/login", {
      headers: { "sec-fetch-site": "cross-site" },
    }),
    env,
  );
  assert.equal(externalNavigation.status, 200);
  assert.ok(
    login.headers
      .get("Content-Security-Policy")
      .includes("frame-ancestors 'none'"),
  );
  const panel = await handle(new Request(url + "/admin"), env);
  assert.equal(panel.status, 302);
  assert.equal(panel.headers.get("location"), url + "/admin/login");
  const status = await handle(new Request(url + "/api/admin/bootstrap"), env);
  assert.deepEqual(await status.json(), { configured: false });
  const api = await handle(new Request(url + "/api/admin/users"), env);
  assert.equal(api.status, 503);
});
