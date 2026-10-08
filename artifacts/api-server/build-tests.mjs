// Bundles integration tests (*.integration.test.ts) for Node's test runner.
// Workspace packages (@workspace/*, TypeScript sources) are bundled; npm packages
// stay external and load from node_modules, exactly as in production.
import path from "node:path";
import { readdir, rm } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
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
    // pnpm keeps each package's dependencies private (e.g. "pg" belongs to
    // @workspace/db), so resolve every npm import from the file that imports it
    // and reference it by absolute URL instead of by bare name.
    name: "external-npm-packages",
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (args.path.startsWith("@workspace/") || args.pluginData?.inner) return undefined;
        if (args.path.startsWith("node:")) return { path: args.path, external: true };
        const result = await pluginBuild.resolve(args.path, {
          kind: args.kind, resolveDir: args.resolveDir, importer: args.importer, pluginData: { inner: true },
        });
        if (result.errors.length) return { errors: result.errors };
        if (result.external || !path.isAbsolute(result.path)) return { path: args.path, external: true };
        return { path: pathToFileURL(result.path).href, external: true };
      });
    },
  }],
});
console.log(`Built ${entryPoints.length} integration test file(s)`);
