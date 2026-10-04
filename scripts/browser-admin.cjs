/* All identity/database responses in this browser test are TEST_ONLY fixtures. */
const { chromium } = require("playwright"),
  assert = require("node:assert/strict"),
  fs = require("node:fs/promises"),
  path = require("node:path");
(async () => {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/bin/chromium",
    args: ["--no-sandbox"],
  });
  const output = process.env.REVECTOR_QA_DIR || "test-results/admin";
  await fs.mkdir(output, { recursive: true });
  const html = await fs.readFile("public/index.html", "utf8"),
    A = "00000000-0000-4000-8000-000000000001",
    U = "00000000-0000-4000-8000-000000000002",
    T = "00000000-0000-4000-8000-000000000005",
    M = "00000000-0000-4000-8000-000000000006";
  let actor = null,
    balance = 12,
    ledger = [],
    messages = [],
    preference = null;
  const tickets = [
    {
      id: T,
      user_id: U,
      type: "SUPPORT",
      subject: "Sleeve review",
      category: "VECTOR_QUALITY",
      payload: { message: "Review the left sleeve.", priority: "NORMAL" },
      status: "OPEN",
      created_at: new Date().toISOString(),
    },
  ];
  const requests = [
    {
      id: crypto.randomUUID(),
      user_id: U,
      type: "TOPUP",
      status: "PENDING",
      payload: { requested_credits: 8 },
    },
    {
      id: crypto.randomUUID(),
      user_id: U,
      type: "MODEL_CHANGE",
      status: "PENDING",
      payload: { desired_model: "QA analyzer", capability: "ANALYZER" },
    },
  ];
  const errors = [],
    calls = [],
    keys = new Set(),
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("https://qa.admin.test/**", async (route) => {
    const req = route.request(),
      url = new URL(req.url()),
      p = url.pathname;
    calls.push(p);
    if (!p.startsWith("/api/"))
      return route.fulfill({ contentType: "text/html", body: html });
    assert.ok(p.startsWith("/api/admin/"));
    let data = {};
    const body = () => req.postDataJSON();
    if (p === "/api/admin/bootstrap") data = { configured: true };
    else if (p === "/api/admin/auth/login") {
      if (body().email === "user@example.test")
        return route.fulfill({
          status: 403,
          json: {
            error: { message: "Not authorized for the Support Console." },
          },
        });
      actor = {
        id: A,
        name: "QA Operator",
        role: body().email === "support@example.test" ? "SUPPORT" : "ADMIN",
        status: "ACTIVE",
      };
      data = { profile: actor };
    } else if (p === "/api/admin/auth/logout") {
      actor = null;
      data = { signed_out: true };
    } else if (!actor)
      return route.fulfill({
        status: 401,
        json: { error: { message: "Sign in required." } },
      });
    else if (
      actor.role === "SUPPORT" &&
      ![/^\/api\/admin\/session$/, /^\/api\/admin\/support(?:\/.*)?$/].some(
        (re) => re.test(p),
      )
    )
      return route.fulfill({
        status: 403,
        json: { error: { message: "Administrator required." } },
      });
    else if (p === "/api/admin/session") data = { profile: actor };
    else if (p === "/api/admin/overview")
      data = {
        total_users: 2,
        pending_topups: requests.filter(
          (r) => r.type === "TOPUP" && r.status === "PENDING",
        ).length,
        open_support: tickets.filter((t) => t.status === "OPEN").length,
      };
    else if (p === "/api/admin/models")
      data = {
        items: [
          {
            id: M,
            display_name: "QA analyzer",
            model_id: "TEST_ONLY_MODEL",
            capability: "ANALYZER",
            enabled: true,
            pricing_version: "UNPRICED",
          },
        ],
      };
    else if (p === "/api/admin/requests") {
      await new Promise((resolve) => setTimeout(resolve, 180));
      data = {
        items: requests.filter((r) => r.type === url.searchParams.get("type")),
      };
    } else if (p === "/api/admin/requests/decide") {
      const d = body(),
        r = requests.find((r) => r.id === d.request_id);
      assert.ok(d.idempotency_key);
      if (r.status !== "PENDING")
        return route.fulfill({
          status: 409,
          json: { error: { message: "Already decided" } },
        });
      r.status = d.decision;
      r.admin_response = d.response;
      if (r.type === "TOPUP" && d.decision === "APPROVED") {
        balance += r.payload.requested_credits;
        ledger.push({ credits_delta: r.payload.requested_credits });
      }
      if (r.type === "MODEL_CHANGE" && d.decision === "APPROVED")
        preference = d.model_id;
    } else if (p === "/api/admin/wallets")
      data = {
        items: [
          { user_id: U, current_credit_balance: balance, reserved_credits: 0 },
        ],
      };
    else if (p === "/api/admin/wallet/adjust") {
      const d = body();
      assert.equal(typeof d.delta, "number");
      assert.ok(d.reason);
      if (!keys.has(d.idempotency_key)) {
        balance += d.delta;
        ledger.push(d);
        keys.add(d.idempotency_key);
      }
    } else if (p === "/api/admin/support") data = { items: tickets };
    else if (p === "/api/admin/support/messages") data = { items: messages };
    else if (p === "/api/admin/support/reply") {
      const d = body();
      tickets[0].status = d.status;
      messages.push({
        author_role: actor.role,
        message: d.message,
        created_at: new Date().toISOString(),
      });
    } else data = { items: [] };
    return route.fulfill({ json: data });
  });
  const nav = (label) =>
    page
      .locator(".account-nav")
      .getByRole("link", { name: label, exact: true })
      .click();
  async function signIn(email) {
    await page.locator("[name=email]").fill(email);
    await page.locator("[name=password]").fill("TEST_ONLY_PASSWORD");
    await page
      .getByRole("button", { name: "Sign In to Admin Console" })
      .click();
  }
  try {
    await page.goto("https://qa.admin.test/admin/login");
    await page.getByRole("heading", { name: "Admin Sign In" }).waitFor();
    assert.equal(
      await page.locator(".workspace,.stepper,.profile-dropdown").count(),
      0,
    );
    await signIn("user@example.test");
    await page.getByRole("alert").waitFor();
    assert.equal(actor, null);
    await signIn("admin@example.test");
    await page
      .getByRole("heading", { name: "Overview", exact: true })
      .waitFor();
    await nav("Credit Requests");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.locator("[name=response]").fill("Verified manual request");
    await page.getByRole("button", { name: "Record Decision" }).click();
    await page.getByText("APPROVED", { exact: true }).waitFor();
    assert.equal(balance, 20);
    assert.equal(ledger.length, 1);
    assert.equal(
      await page.getByRole("button", { name: "Review", exact: true }).count(),
      0,
    );
    await nav("Model Requests");
    await page.getByRole("button", { name: "Review", exact: true }).click();
    await page.locator("[name=model_id]").selectOption(M);
    await page
      .locator("[name=response]")
      .fill("Approved available analyzer preference");
    await page.getByRole("button", { name: "Record Decision" }).click();
    await page.getByText("APPROVED", { exact: true }).waitFor();
    assert.equal(preference, M);
    await nav("Wallet / Balances");
    await page.getByRole("button", { name: "Adjust", exact: true }).click();
    await page.locator("[name=delta]").fill("-3");
    await page.locator("[name=reason]").fill("Audited QA correction");
    await page.getByRole("button", { name: "Record Adjustment" }).click();
    await page.getByText("Saved successfully.", { exact: true }).waitFor();
    assert.equal(balance, 17);
    assert.equal(ledger.length, 2);
    await nav("Support Inbox");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await page
      .locator("[name=message]")
      .fill("Review the crop boundary and validate again.");
    await page.locator("[name=status]").selectOption("IN_PROGRESS");
    await page.getByRole("button", { name: "Send Support Reply" }).click();
    await page.getByText("IN_PROGRESS", { exact: true }).waitFor();
    assert.equal(messages.length, 1);
    for (const width of [1920, 1600, 1440, 1366, 1280, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: path.join(output, "admin-support-" + width + ".png"),
        fullPage: true,
      });
    }
    await page.getByRole("button", { name: "Sign Out", exact: true }).click();
    await page.getByRole("heading", { name: "Admin Sign In" }).waitFor();
    await signIn("support@example.test");
    await page
      .getByRole("heading", { name: "Support Inbox", exact: true, level: 1 })
      .waitFor();
    assert.equal(await page.locator(".account-nav a").count(), 1);
    assert.equal(
      await page.getByRole("link", { name: "Wallet / Balances" }).count(),
      0,
    );
    assert.deepEqual(errors, []);
    assert.ok(
      !calls.some(
        (p) => p.startsWith("/api/revector") || p.startsWith("/api/account"),
      ),
    );
    console.log(
      JSON.stringify({
        admin_browser: "PASS",
        separate_application: "PASS",
        topup_and_model_approval: "PASS",
        wallet_adjustment: "PASS",
        support_reply: "PASS",
        support_role: "PASS",
        responsive_widths: [1920, 1600, 1440, 1366, 1280, 390],
        page_errors: errors,
        fixtures: "TEST_ONLY",
      }),
    );
  } finally {
    await browser.close();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
