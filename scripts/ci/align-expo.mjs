// Sets the phone app's Expo packages to the versions its Expo SDK expects
// (expo/bundledNativeModules.json). Run after an install; prints what changed.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const pkgPath = path.resolve("artifacts/price-bot-mobile/package.json");
const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
const require = createRequire(pkgPath);
const bundled = require("expo/bundledNativeModules.json");
const changed = [];
for (const section of ["dependencies", "devDependencies"]) {
  for (const [name, range] of Object.entries(pkg[section] ?? {})) {
    if (!bundled[name] || bundled[name] === range || /^(workspace|catalog):/.test(range)) continue;
    pkg[section][name] = bundled[name];
    changed.push(`${name} ${range} → ${bundled[name]}`);
  }
}
if (changed.length) {
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
  console.log(`::notice title=Expo versions aligned::${changed.join(", ")}`);
} else {
  console.log("Expo package versions already match the SDK");
}
