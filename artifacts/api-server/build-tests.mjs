// Bundles integration tests (*.integration.test.ts) for Node's test runner.
// Workspace packages (@workspace/*, TypeScript sources) are bundled; npm packages
// stay external and load from node_modules, exactly as in production.
import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.dirname(fileURLToPath(import.meta.url));
const testsDir = path.join(root, "src/tests");
const outdir = path.join(root, "dist-tests");

const entryPoints = (await readdir(testsDir))
  .filter((name) => name.endsWith(".integration.test.ts"))
  .map((name) => path.join(testsDir, name));

await rm(outdir, { recursive: true, force: true });
await build({
  entryPoints,
  outdir,
  bundle: true,
  platform: "node",
  format: "esm",
  outExtension: { ".js": ".mjs" },
  sourcemap: "inline",
  logLevel: "warning",
  plugins: [{
    name: "external-npm-packages",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^[^./]/ }, (args) =>
        args.path.startsWith("@workspace/") ? undefined : { path: args.path, external: true });
    },
  }],
});
console.log(`Built ${entryPoints.length} integration test file(s)`);
