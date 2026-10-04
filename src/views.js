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
  if (page === "overview")
    return (
      `<div class="account-metrics">${
        Object.entries(d)
          .filter(([k, v]) => typeof v === "number" || v === null)
          .map(
            ([k, v]) =>
              `<section><small>${e(k.replaceAll("_", " "))}</small><strong>${money(v)}</strong></section>`,
          )
          .join("") || empty("No operational data loaded.")
      }</div>` +
      panel(
        "Support & Operations",
        "<p>Global reports are available only in this console. Wallet changes use append-only ledger transactions and audited reasons.</p>",
      )
    );
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
      panel(
        "Balances",
        table(
          ["User ID", "Balance", "Reserved", "Action"],
          items.map((v) => [
            e(v.user_id),
            money(v.current_credit_balance),
            money(v.reserved_credits),
            button("Adjust", "edit-wallet", `data-id="${e(v.user_id)}"`),
          ]),
        ),
      ) +
      panel(
        "Audited Wallet Adjustment",
        form(
          "adjust",
          field(
            "User ID",
            "user_id",
            "text",
            account.editUser || "",
            "required",
          ) +
            field(
              "Credits delta (negative to deduct)",
              "delta",
              "number",
              "",
              'required min="-1000000" max="1000000" step="0.0001"',
            ) +
            area("Required reason", "reason", 'maxlength="1000"'),
          "Record Adjustment",
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
  if (page === "settings")
    return (
      panel(
        "Control Backend Settings",
        `<dl class="account-details">${Object.entries(d.settings || {})
          .map(
            ([key, value]) =>
              `<dt>${e(key.replaceAll("_", " "))}</dt><dd>${e(value == null ? "Not configured" : String(value))}</dd>`,
          )
          .join(
            "",
          )}</dl><p class="muted">Engine and production secrets are managed separately. This console cannot change Railway settings.</p>`,
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
  return `<div class="account-layout admin-console"><header><a class="console-brand" href="/admin" data-account="nav"><span class="gold-mark">R</span><strong>ReVector AI<small>ADMIN CONSOLE · Support & Operations</small></strong></a><div class="right">${badge(profile.role)}${button("Sign Out", "admin-logout")}</div></header><div class="account-shell"><nav class="account-nav" aria-label="Admin navigation">${pages.map(([route, label]) => `<a href="/admin/${route}" class="${page === route ? "active" : ""}" data-account="nav">${label}</a>`).join("")}</nav><main class="account-main"><div class="account-heading"><div><div class="section-kicker">Operations & Support</div><h1>${e(pages.find(([r]) => r === page)?.[1] || page)}</h1></div>${button("Refresh", "refresh")}</div>${account.error ? `<p class="account-error" role="alert">${e(account.error)}</p>` : ""}${account.notice ? `<p class="account-notice" role="status">${e(account.notice)}</p>` : ""}${account.busy ? '<p role="status">Loading operations data…</p>' : ""}${account.configured === false ? empty("Supabase configuration is required before sign in.") : adminContent(page)}${["usage", "support", "credits", "models", "users", "wallets", "audit"].includes(page) ? `<div class="account-pager">${button("Previous", "previous", account.offset === 0 ? "disabled" : "")}<span>Page ${account.offset / 50 + 1}</span>${button("Next", "next", (account.data.items || []).length < 50 ? "disabled" : "")}</div>` : ""}</main></div></div>`;
}
