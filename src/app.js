import { accountMarkup } from "./views.js";
import {
  registerRenderer,
  initialize,
  click,
  submit,
  restoreRoute,
} from "./controller.js";
const app = document.getElementById("app");
function render() {
  app.innerHTML = accountMarkup();
}
registerRenderer(render);
document.addEventListener("click", (event) => {
  const target = event.target.closest("[data-account]");
  if (target) {
    event.preventDefault();
    click(target);
  }
});
document.addEventListener("submit", (event) => {
  const form = event.target.closest("[data-account-form]");
  if (form) {
    event.preventDefault();
    submit(form);
  }
});
window.addEventListener("popstate", restoreRoute);
render();
initialize();
