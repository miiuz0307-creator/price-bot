// Bundles integration tests the same way the server is bundled (workspace
// TypeScript packages inlined, npm packages loaded from node_modules).
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readdirSync } from "node:fs";
import { build } from "esbuild";

const dir = path.dirname(fileURLToPath(import.meta.url));
const entryPoints = readdirSync(dir).filter((file) => file.endsWith(".test.ts")).map((file) => path.join(dir, file));

await build({
  entryPoints,
  outdir: path.resolve(dir, "../dist-tests"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  sourcemap: "inline",
  logLevel: "warning",
  // Same approach as build.mjs: bundle everything except packages that must load from disk.
  external: ["*.node", "qrcode", "protobufjs", "pino-pretty", "sharp", "bufferutil", "utf-8-validate", "pg-native"],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; import __p from 'node:path'; import __u from 'node:url'; globalThis.require = __cr(import.meta.url); globalThis.__filename = __u.fileURLToPath(import.meta.url); globalThis.__dirname = __p.dirname(globalThis.__filename);",
  },
});
console.log(`Built ${entryPoints.length} integration test file(s)`);
