export const account = {
  configured: null,
  adminProfile: null,
  busy: false,
  error: "",
  notice: "",
  data: {},
  ticket: null,
  messages: [],
  offset: 0,
  supportFilter: "ALL",
  editUser: null,
  editModel: null,
};
export const adminPages = [
  ["overview", "Overview"],
  ["users", "Users"],
  ["wallets", "Wallet / Balances"],
  ["payments", "Payment Methods"],
  ["credits", "Credit Requests"],
  ["usage", "Usage Logs"],
  ["models", "Model Requests"],
  ["support", "Support Inbox"],
  ["audit", "Audit Log"],
  ["settings", "Settings"],
];
export function currentPath() {
  return typeof location !== "undefined" ? location.pathname : "/admin/login";
}
export function accountPage() {
  return currentPath() === "/admin/login"
    ? "admin-login"
    : currentPath().split("/")[2] || "overview";
}
