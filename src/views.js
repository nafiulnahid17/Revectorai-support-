import { account, adminPages, accountPage } from "./model.js";
const escape = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const e = escape;
const money = (v) =>
  v == null
    ? "Unavailable"
    : Number(v).toLocaleString(undefined, { maximumFractionDigits: 4 });
const date = (v) => (v ? e(new Date(v).toLocaleString()) : "—");
const field = (label, name, type = "text", value = "", extra = "") =>
  `<label class="account-field"><span>${label}</span><input name="${name}" type="${type}" value="${e(value || "")}" ${extra}></label>`;
const area = (label, name, extra = "") =>
  `<label class="account-field"><span>${label}</span><textarea name="${name}" rows="3" required maxlength="4000" ${extra}></textarea></label>`;
const select = (label, name, choices, value = "") =>
  `<label class="account-field"><span>${label}</span><select name="${name}">${choices.map(([key, label]) => `<option value="${e(key)}" ${key === value ? "selected" : ""}>${e(label)}</option>`).join("")}</select></label>`;
const button = (label, action, extra = "") =>
  `<button type="button" data-account="${action}" ${extra}>${label}</button>`;
const submit = (label) =>
  `<button class="primary" type="submit" ${account.busy ? "disabled" : ""}>${account.busy ? "Saving…" : label}</button>`;
const form = (name, body, label) =>
  `<form class="account-form" data-account-form="${name}"><fieldset ${account.busy ? "disabled" : ""}>${body}${submit(label)}</fieldset></form>`;
const panel = (title, content) =>
  `<section class="account-card"><h2>${title}</h2>${content}</section>`;
const empty = (message) => `<div class="account-empty">${message}</div>`;
function table(headers, rows) {
  return rows.length
    ? `<div class="table-scroll"><table class="account-table"><thead><tr>${headers.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`
    : empty("No records yet.");
}
const badge = (status) =>
  `<span class="account-badge">${e(status || "—")}</span>`;

const navIcons = {
  overview: "◈",
  users: "◎",
  wallets: "◇",
  credits: "＋",
  usage: "⌁",
  models: "✦",
  support: "◌",
  audit: "▤",
  settings: "⚙",
};
const navIcon = (route) =>
  `<span class="nav-icon" aria-hidden="true">${navIcons[route] || "•"}</span>`;

function svgLine(points, key, suffix = "") {
  if (!Array.isArray(points) || !points.length)
    return empty("No chart data yet.");
  const values = points.map((p) => Number(p[key] || 0));
  const max = Math.max(...values, 1);
  const width = 620;
  const height = 150;
  const step = values.length > 1 ? width / (values.length - 1) : width;
  const coords = values
    .map((value, index) => {
      const x = Math.round(index * step * 100) / 100;
      const y =
        Math.round((height - (value / max) * (height - 18) - 8) * 100) / 100;
      return `${x},${y}`;
    })
    .join(" ");
  const latest = values.at(-1) || 0;
  return `<div class="digital-chart">
    <div class="digital-chart-value">${money(latest)}${suffix}</div>
    <svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(key.replaceAll("_", " "))} last 30 days">
      <polyline class="chart-line" points="${coords}"></polyline>
    </svg>
    <div class="chart-axis"><span>30 days ago</span><span>Today</span></div>
  </div>`;
}

function metricTile(label, value, detail = "") {
  return `<section class="metric-tile"><small>${e(label)}</small><strong>${money(value)}</strong>${detail ? `<span>${e(detail)}</span>` : ""}</section>`;
}
function login(admin) {
  return `<div class="account-login ${admin ? "admin-login" : ""}"><a class="console-brand" href="/" data-account="nav"><span class="gold-mark">R</span><strong>ReVector AI</strong></a><section class="login-card"><div class="section-kicker">${admin ? "Support & Operations Console" : "Invite-only account"}</div><h1>${admin ? "Admin Sign In" : "Welcome to ReVector"}</h1><p class="muted">${admin ? "Authorized administrators and support staff only." : "Sign in with your invited account to access your production workspace."}</p>${account.configured === false ? empty("Account services are not configured. Contact the owner to enable Supabase Auth.") : form(admin ? "admin-login" : "login", field(admin ? "Admin Email" : "Email", "email", "email", "", 'required autocomplete="username"') + field("Password", "password", "password", "", 'required autocomplete="current-password"'), admin ? "Sign In to Admin Console" : "Sign In")}${account.error ? `<p role="alert" class="account-error">${e(account.error)}</p>` : ""}${!admin ? '<a href="/" data-account="nav">Return to production workspace</a>' : ""}</section></div>`;
}
function usage(items, admin = false) {
  return table(
    [
      ...(admin ? ["User"] : []),
      "Operation / Project",
      "Provider / Model",
      "Mode / Status",
      "Provider cost",
      "Credits",
      "Time",
    ],
    items
      .filter((v) => v.status !== "RESERVED")
      .map((v) => [
        ...(admin ? [e(v.user_id)] : []),
        `${e(v.operation)}<small>${e(v.project_id || "No project")}</small>`,
        `${e(v.provider || "Not reported")}<small>${e(v.model || "Not reported")}</small>`,
        `${badge(v.processing_mode)} ${badge(v.status)}`,
        v.estimated_usd_cost == null
          ? v.processing_mode === "DETERMINISTIC"
            ? "Not applicable"
            : "Unavailable"
          : `$${Number(v.estimated_usd_cost).toFixed(6)}<small>${e(v.cost_source)} · ${e(v.pricing_version || "")}</small>`,
        money(v.credits_charged),
        date(v.created_at),
      ]),
  );
}
function ledger(items) {
  return table(
    ["Type", "Credits", "Balance after", "Reason / Reference", "Time"],
    items.map((v) => [
      badge(v.type),
      money(v.credits_delta),
      money(v.balance_after),
      `${e(v.reason)}<small>${e(v.reference)}</small>`,
      date(v.created_at),
    ]),
  );
}
function tickets(items, admin = false) {
  return table(
    admin
      ? ["User", "Subject / Category / Priority", "Status", "Created", ""]
      : ["Subject / Category", "Status", "Reply", "Updated", ""],
    items.map((v) =>
      admin
        ? [
            `${e(v.revector_profiles?.name || v.user_id)}<small>${e(v.revector_profiles?.email || "")}</small>`,
            `${e(v.subject)}<small>${e(v.category || "OTHER")} · ${e(v.payload?.priority || "NORMAL")}</small>`,
            badge(v.status),
            date(v.created_at),
            button("Open", "ticket", `data-id="${e(v.id)}"`),
          ]
        : [
            `${e(v.subject)}<small>${e(v.category)}</small>`,
            badge(v.status),
            e(v.admin_response || "Awaiting reply"),
            date(v.updated_at),
            button("Open", "ticket", `data-id="${e(v.id)}"`),
          ],
    ),
  );
}
function conversation(admin) {
  const t = account.ticket;
  if (!t) return "";
  return panel(
    e(t.subject),
    `<div class="ticket-thread"><article><strong>Original request</strong><p>${e(t.payload?.message || "")}</p><small>${date(t.created_at)}</small></article>${account.messages.map((m) => `<article><strong>${e(m.author_role === "USER" ? "User" : "ReVector Support")}</strong><p>${e(m.message)}</p><small>${date(m.created_at)}</small></article>`).join("")}</div>${form(
      admin ? "support-reply" : "support-message",
      `<input type="hidden" name="request_id" value="${e(t.id)}">` +
        area("Reply", "message") +
        (admin
          ? select(
              "Ticket status",
              "status",
              [
                ["OPEN", "Open"],
                ["IN_PROGRESS", "In Progress"],
                ["RESOLVED", "Resolved"],
                ["CLOSED", "Closed"],
              ],
              t.status,
            )
          : ""),
      admin ? "Send Support Reply" : "Send Message",
    )}${button("Close conversation", "close-ticket")}`,
  );
}
function adminContent(page) {
  const d = account.data,
    items = d.items || [];
  if (page === "overview") {
    const daily = d.charts?.daily || [];
    return `<section class="overview-hero">
        <div><div class="section-kicker">LIVE OPERATIONS</div><h2>ReVector Control Overview</h2><p>Real operational totals and the last ${e(d.chart_window_days || 30)} days of recorded activity.</p></div>
        <span class="overview-live"><i></i> Live data</span>
      </section>
      <div class="metric-grid">
        ${metricTile("Total Users", d.total_users, `${money(d.active_accounts)} active`)}
        ${metricTile("Credits Used", d.credits_used)}
        ${metricTile("Open Support", d.open_support, `${money(d.resolved_support)} resolved`)}
        ${metricTile("Pending Top-ups", d.pending_topups)}
        ${metricTile("Model Requests", d.model_requests)}
        ${metricTile("Failed Usage", d.failed_usage_events)}
        ${metricTile("Actual AI Cost (USD)", d.actual_reported_ai_cost_usd)}
        ${metricTile("Estimated AI Cost (USD)", d.estimated_ai_cost_usd)}
      </div>
      <div class="overview-chart-grid">
        ${panel("AI / Tool Activity", svgLine(daily, "usage_events"))}
        ${panel("Credits Consumed", svgLine(daily, "credits_used"))}
        ${panel("AI Cost Trend", svgLine(daily, "ai_cost_usd", " USD"))}
        ${panel("Wallet Recharge Volume", svgLine(daily, "wallet_credits"))}
        ${panel(
          "Support Queue",
          `<div class="status-rings">
            ${Object.entries(d.charts?.support || {}).map(([status, value]) => `<div><strong>${money(value)}</strong><span>${e(status.replaceAll("_", " "))}</span></div>`).join("") || empty("No support activity yet.")}
          </div>`,
        )}
      </div>`;
  }
  if (page === "users")
    return (
      panel(
        "Users",
        table(
          ["User", "Role", "Status", "Created", "Actions"],
          items.map((v) => [
            `${e(v.name || v.email)}<small>${e(v.id)}</small>`,
            badge(v.role),
            badge(v.status),
            date(v.created_at),
            button("Change Status", "edit-status", `data-id="${e(v.id)}"`),
          ]),
        ),
      ) +
      (account.editUser
        ? panel(
            "Account status",
            form(
              "status",
              `<input type="hidden" name="user_id" value="${e(account.editUser)}">` +
                select("Status", "status", [
                  ["ACTIVE", "Active"],
                  ["SUSPENDED", "Suspended"],
                  ["DISABLED", "Disabled"],
                ]) +
                area("Reason", "reason", 'maxlength="1000"'),
              "Apply Status",
            ),
          )
        : "")
    );
  if (page === "wallets")
    return (
      `<section class="wallet-summary-banner"><div><div class="section-kicker">WALLET CONTROL</div><h2>Balances & Credit Recharge</h2><p>Add or deduct credits with an auditable payment method, transaction reference and server-recorded time.</p></div><span>${items.length} wallets loaded</span></section>` +
      panel(
        "Balances",
        table(
          ["User ID", "Available Balance", "Reserved", "Action"],
          items.map((v) => [
            e(v.user_id),
            `<strong class="wallet-amount">${money(v.current_credit_balance)}</strong>`,
            money(v.reserved_credits),
            button("Manage Balance", "edit-wallet", `data-id="${e(v.user_id)}"`),
          ]),
        ),
      ) +
      panel(
        "Add / Deduct Balance",
        `<div class="wallet-form-note">Transaction time is recorded automatically by the server when the adjustment succeeds.</div>` +
          form(
            "adjust",
            field(
              "User ID",
              "user_id",
              "text",
              account.editUser || "",
              "required",
            ) +
              select("Action", "direction", [
                ["ADD", "Add balance / credit recharge"],
                ["DEDUCT", "Deduct balance"],
              ]) +
              field(
                "Credit recharge",
                "credits",
                "number",
                "",
                'required min="0.0001" max="1000000" step="0.0001"',
              ) +
              select("Transaction method", "payment_method", [
                ["BKASH", "bKash"],
                ["NAGAD", "Nagad"],
                ["BANK_TRANSFER", "Bank Transfer"],
                ["CARD", "Card"],
                ["CASH", "Cash"],
                ["MANUAL", "Manual Adjustment"],
                ["OTHER", "Other"],
              ]) +
              field(
                "Transaction / Reference ID",
                "transaction_reference",
                "text",
                "",
                'required maxlength="180"',
              ) +
              area("Notes / reason", "note", 'maxlength="600"'),
            "Record Balance Transaction",
          ),
      ) +
      panel(
        "Recent Wallet Transactions",
        table(
          [
            "Type",
            "Credits",
            "Balance After",
            "Transaction Details",
            "Recorded Time",
          ],
          (d.transactions || []).map((v) => [
            badge(v.type),
            `<strong class="${Number(v.credits_delta) >= 0 ? "credit-positive" : "credit-negative"}">${Number(v.credits_delta) >= 0 ? "+" : ""}${money(v.credits_delta)}</strong>`,
            money(v.balance_after),
            `${e(v.reason)}<small>${e(v.reference)}</small>`,
            date(v.created_at),
          ]),
        ),
      )
    );
  if (["credits", "models"].includes(page))
    return (
      panel(
        page === "credits" ? "Credit Requests" : "Model Requests",
        table(
          ["User", "Request", "Status", "Response", "Actions"],
          items.map((v) => [
            e(v.user_id),
            e(
              v.type === "TOPUP"
                ? v.payload.requested_credits + " credits"
                : v.payload.desired_model,
            ),
            badge(v.status),
            e(v.admin_response || "—"),
            v.status === "PENDING"
              ? button("Review", "review-request", `data-id="${e(v.id)}"`)
              : "—",
          ]),
        ),
      ) +
      (account.ticket
        ? panel(
            "Review Request",
            form(
              "decision",
              `<input type="hidden" name="request_id" value="${e(account.ticket.id)}">` +
                select("Decision", "decision", [
                  ["APPROVED", "Approve"],
                  ["REJECTED", "Reject"],
                  ["REPLY", "Reply without changing status"],
                ]) +
                (page === "models"
                  ? select("Approved catalog model", "model_id", [
                      ["", "Choose approved model"],
                      ...(d.catalog || []).map((m) => [m.id, m.display_name]),
                    ])
                  : "") +
                area("Response / reason", "response"),
              "Record Decision",
            ),
          )
        : "")
    );
  if (page === "usage") return panel("Global Usage", usage(items, true));
  if (page === "support")
    return conversation(true) + panel("Support Inbox", tickets(items, true));
  if (page === "audit")
    return panel(
      "Append-only Audit Log",
      table(
        ["Actor", "Action", "Target", "Reason", "Time"],
        items.map((v) => [
          e(v.admin_user_id),
          e(v.action),
          e(v.target),
          e(v.reason),
          date(v.created_at),
        ]),
      ),
    );
  if (page === "settings") {
    const settings = d.settings || {};
    const payment = settings.payment_settings || {};
    const bkash = payment.bkash || {};
    const nagad = payment.nagad || {};
    const paymentForm = form(
      "payment-settings",
      '<div class="payment-settings-grid">' +
        '<section class="payment-config-card rate-card">' +
          '<div class="payment-config-head"><span>FX</span><div><strong>USD → BDT Conversion</strong><small>This rate is shown live on the user Add Credits page.</small></div></div>' +
          field(
            "1 USD = BDT",
            "usd_to_bdt_rate",
            "number",
            payment.usd_to_bdt_rate ?? "",
            'required min="0.0001" max="10000" step="0.0001"',
          ) +
        "</section>" +
        '<section class="payment-config-card">' +
          '<div class="payment-config-head bkash"><span>bK</span><div><strong>bKash</strong><small>User-facing manual payment destination.</small></div></div>' +
          select(
            "Availability",
            "bkash_enabled",
            [["true","Enabled"],["false","Disabled"]],
            String(Boolean(bkash.enabled)),
          ) +
          field("bKash Number", "bkash_number", "text", bkash.number || "", 'maxlength="40" placeholder="No number configured"') +
          '<label class="account-field"><span>bKash Instructions — one step per line</span><textarea name="bkash_instructions" rows="5" maxlength="2400" placeholder="No instructions configured">' +
            e(Array.isArray(bkash.instructions) ? bkash.instructions.join("\n") : "") +
          "</textarea></label>" +
        "</section>" +
        '<section class="payment-config-card">' +
          '<div class="payment-config-head nagad"><span>N</span><div><strong>Nagad</strong><small>User-facing manual payment destination.</small></div></div>' +
          select(
            "Availability",
            "nagad_enabled",
            [["true","Enabled"],["false","Disabled"]],
            String(Boolean(nagad.enabled)),
          ) +
          field("Nagad Number", "nagad_number", "text", nagad.number || "", 'maxlength="40" placeholder="No number configured"') +
          '<label class="account-field"><span>Nagad Instructions — one step per line</span><textarea name="nagad_instructions" rows="5" maxlength="2400" placeholder="No instructions configured">' +
            e(Array.isArray(nagad.instructions) ? nagad.instructions.join("\n") : "") +
          "</textarea></label>" +
        "</section>" +
      "</div>" +
      '<p class="payment-settings-note">Saving here updates the shared control database. The ReVector user Add Credits page reads these values; no payment number or instruction is hardcoded in the user interface.</p>',
      "Save Payment Configuration",
    );

    return (
      panel(
        "Payment Configuration",
        '<div class="payment-settings-hero"><div><div class="section-kicker">USER TOP-UP CONTROL</div><h3>bKash, Nagad & Conversion Rate</h3><p>Manage exactly what users see when they add balance. Disabled methods cannot be submitted.</p></div>' +
          (payment.updated_at
            ? '<span>Last updated ' + date(payment.updated_at) + "</span>"
            : '<span>Not configured yet</span>') +
        "</div>" +
        paymentForm,
      ) +
      panel(
        "Control Backend Settings",
        '<dl class="account-details">' +
          Object.entries(settings)
            .filter(([key]) => key !== "payment_settings")
            .map(
              ([key, value]) =>
                '<dt>' + e(key.replaceAll("_", " ")) + "</dt><dd>" +
                e(value == null ? "Not configured" : String(value)) +
                "</dd>",
            )
            .join("") +
        '</dl><p class="muted">Engine and production secrets are managed separately. This console cannot change Railway settings.</p>',
      ) +
      panel(
        "Model Catalog",
        table(
          ["Model", "Enabled", "Pricing version", ""],
          (d.catalog || []).map((m) => [
            `${e(m.display_name)}<small>${e(m.model_id)}</small>`,
            e(String(m.enabled)),
            e(m.pricing_version),
            button("Configure", "edit-model", `data-id="${e(m.id)}"`),
          ]),
        ),
      ) +
      (account.editModel
        ? panel(
            "Catalog Pricing",
            form(
              "catalog",
              `<input type="hidden" name="model_id" value="${e(account.editModel.id)}">` +
                select(
                  "Availability",
                  "enabled",
                  [
                    ["true", "Enabled"],
                    ["false", "Disabled"],
                  ],
                  String(account.editModel.enabled),
                ) +
                field(
                  "Pricing version",
                  "pricing_version",
                  "text",
                  account.editModel.pricing_version,
                  "required",
                ) +
                area(
                  "Operation prices in USD (JSON object)",
                  "operation_prices",
                ) +
                area("Change reason", "reason"),
              "Save Catalog",
            ),
          )
        : "")
    );
  }
  return empty("This console page does not exist.");
}
export function accountMarkup() {
  const page = accountPage();
  if (page === "admin-login" || !account.adminProfile) return login(true);
  const profile = account.adminProfile;
  const pages =
    profile.role === "SUPPORT"
      ? adminPages.filter(([key]) => key === "support")
      : adminPages;
  return `<div class="account-layout admin-console"><header><a class="console-brand" href="/admin" data-account="nav"><span class="gold-mark">R</span><strong>ReVector AI<small>ADMIN CONSOLE · Support & Operations</small></strong></a><div class="right">${badge(profile.role)}${button("Sign Out", "admin-logout")}</div></header><div class="account-shell"><nav class="account-nav" aria-label="Admin navigation">${pages.map(([route, label]) => `<a href="/admin/${route}" class="${page === route ? "active" : ""}" data-account="nav">${navIcon(route)}<span>${label}</span></a>`).join("")}</nav><main class="account-main"><div class="account-heading"><div><div class="section-kicker">Operations & Support</div><h1>${e(pages.find(([r]) => r === page)?.[1] || page)}</h1></div>${button("Refresh", "refresh")}</div>${account.error ? `<p class="account-error" role="alert">${e(account.error)}</p>` : ""}${account.notice ? `<p class="account-notice" role="status">${e(account.notice)}</p>` : ""}${account.busy ? '<p role="status">Loading operations data…</p>' : ""}${account.configured === false ? empty("Supabase configuration is required before sign in.") : adminContent(page)}${["usage", "support", "credits", "models", "users", "wallets", "audit"].includes(page) ? `<div class="account-pager">${button("Previous", "previous", account.offset === 0 ? "disabled" : "")}<span>Page ${account.offset / 50 + 1}</span>${button("Next", "next", (account.data.items || []).length < 50 ? "disabled" : "")}</div>` : ""}</main></div></div>`;
}
