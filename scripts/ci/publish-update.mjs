// Publishes an `expo export` folder as an over-the-air update to the server.
// usage: node publish-update.mjs <export-dir> <expo-config.json>
// env: UPDATE_URL (server base URL), APP_UPDATE_TOKEN, RUNTIME_VERSION (default from config), MESSAGE
import { readFileSync } from "node:fs";
import path from "node:path";

const [dir, configPath] = process.argv.slice(2);
const base = (process.env.UPDATE_URL ?? "").replace(/\/+$/, "");
const token = process.env.APP_UPDATE_TOKEN ?? "";
if (!dir || !configPath || !base || !token) throw new Error("usage: UPDATE_URL=… APP_UPDATE_TOKEN=… node publish-update.mjs <export-dir> <expo-config.json>");

const metadata = JSON.parse(readFileSync(path.join(dir, "metadata.json"), "utf8"));
const expoConfig = JSON.parse(readFileSync(configPath, "utf8"));
const platform = "android";
const fileMetadata = metadata.fileMetadata[platform];
const files = {};
for (const relPath of [fileMetadata.bundle, ...fileMetadata.assets.map((asset) => asset.path)]) {
  files[relPath] = readFileSync(path.join(dir, relPath)).toString("base64");
}
const runtimeVersion = process.env.RUNTIME_VERSION ?? (typeof expoConfig.runtimeVersion === "string" ? expoConfig.runtimeVersion : "1");
const body = JSON.stringify({ platform, runtimeVersion, expoConfig, metadata, files, message: process.env.MESSAGE ?? "" });
console.log(`Publishing ${Object.keys(files).length} files (${(body.length / 1e6).toFixed(1)} MB) for runtime ${runtimeVersion} to ${base}`);

// The server may still be deploying the same commit: retry for a few minutes.
for (let attempt = 1; ; attempt += 1) {
  try {
    const response = await fetch(`${base}/api/app-updates/publish`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body,
    });
    const text = await response.text();
    if (response.ok) { console.log(`Published: ${text}`); break; }
    if (response.status === 401 || response.status === 400 || attempt >= 16) throw new Error(`publish failed (${response.status}): ${text.slice(0, 300)}`);
    console.log(`Server answered ${response.status}; retrying (${attempt})`);
  } catch (error) {
    if (attempt >= 16 || /publish failed/.test(String(error))) throw error;
    console.log(`Server not reachable (${error.message}); retrying (${attempt})`);
  }
  await new Promise((resolve) => setTimeout(resolve, 20_000));
}
