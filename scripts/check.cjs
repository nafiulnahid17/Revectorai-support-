const fs = require("node:fs"),
  path = require("node:path"),
  child = require("node:child_process");
function check(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const target = path.join(dir, item.name);
    if (item.isDirectory()) check(target);
    else if (/\.(?:js|cjs)$/.test(item.name))
      child.execFileSync(process.execPath, ["--check", target], {
        stdio: "inherit",
      });
  }
}
for (const dir of ["src", "worker", "scripts", "tests"]) check(dir);
console.log(
  "All JavaScript modules, Worker routes, tests and build scripts parse.",
);
