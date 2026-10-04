const fs = require("node:fs"),
  path = require("node:path"),
  vm = require("node:vm"),
  crypto = require("node:crypto"),
  esbuild = require("esbuild");
const root = path.resolve(__dirname, "..");
const views = esbuild.buildSync({
  entryPoints: [path.join(root, "src/views.js")],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
}).outputFiles[0].text;
const sandbox = { module: { exports: {} } };
vm.runInNewContext(views, sandbox);
const markup = sandbox.module.exports.accountMarkup();
const javascript = esbuild
  .buildSync({
    entryPoints: [path.join(root, "src/app.js")],
    bundle: true,
    format: "iife",
    target: "es2020",
    write: false,
  })
  .outputFiles[0].text.replace(/<\/script/g, "<\\/script");
const read = (p) => fs.readFileSync(path.join(root, p), "utf8");
const css =
  read("public/assets/fonts.css") +
  "\n" +
  read("src/base.css") +
  "\n" +
  read("src/account.css");
const script = "\n" + javascript + "\n";
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07111d"><title>ReVector — Admin / Support Console</title><link rel="icon" href="/assets/mark.svg" type="image/svg+xml"><style>${css}</style></head><body><div id="app">${markup}</div><noscript>Enable JavaScript to use the Admin / Support console.</noscript><script>${script}</script></body></html>`;
fs.writeFileSync(path.join(root, "public/index.html"), html);
fs.writeFileSync(
  path.join(root, "worker/security-manifest.json"),
  JSON.stringify({
    scriptHash: crypto.createHash("sha256").update(script).digest("base64"),
  }) + "\n",
);
console.log(
  `Built standalone ADMIN console (${Buffer.byteLength(html)} bytes), without engine credentials or production workflow.`,
);
