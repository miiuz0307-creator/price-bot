import { createHash, createPublicKey, createVerify, randomUUID, timingSafeEqual, type JsonWebKey } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import express, { Router, type Request, type Response } from "express";
import { logger } from "../lib/logger";

/**
 * Over-the-air updates for the phone app (Expo Updates protocol v0/v1), served by
 * this server — no app store and no third-party service. CI publishes each new
 * version of the app's code here; installed apps download it on launch / when
 * they come back to the foreground. Native changes (new modules, icons…) still
 * need a new APK; they bump the app's runtimeVersion so old installs never get
 * code they cannot run.
 *
 * Files live on the persistent volume next to the WhatsApp sessions.
 */
export function updatesRoot() {
  if (process.env.APP_UPDATES_DIR) return path.resolve(process.env.APP_UPDATES_DIR);
  if (process.env.WHATSAPP_AUTH_DIR) return path.join(path.dirname(path.resolve(process.env.WHATSAPP_AUTH_DIR)), "app-updates");
  return path.resolve(".local/app-updates");
}

type StoredAsset = { path: string; hash: string; key: string; fileExtension?: string; contentType: string };
type StoredManifest = {
  id: string; createdAt: string; runtimeVersion: string; platform: string; message: string;
  launchAsset: StoredAsset; assets: StoredAsset[]; expoConfig: Record<string, unknown>;
};

const platforms = new Set(["android", "ios"]);
const validRuntime = (value: unknown): value is string => typeof value === "string" && /^[\w.-]{1,40}$/.test(value);
const validId = (value: string) => /^[0-9a-f-]{36}$/.test(value);
const contentTypes: Record<string, string> = {
  js: "application/javascript", hbc: "application/javascript", bundle: "application/javascript",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml",
  ttf: "font/ttf", otf: "font/otf", json: "application/json",
};
const pointerPath = (platform: string, runtime: string) => path.join(updatesRoot(), "current", `${platform}-${runtime}.json`);

function describe(file: Buffer, relPath: string, ext?: string): StoredAsset {
  return {
    path: relPath,
    hash: createHash("sha256").update(file).digest("base64url"),
    key: createHash("md5").update(file).digest("hex"),
    ...(ext ? { fileExtension: `.${ext}` } : {}),
    contentType: contentTypes[(ext ?? path.extname(relPath).slice(1)).toLowerCase()] ?? "application/octet-stream",
  };
}

async function currentManifest(platform: string, runtime: string): Promise<StoredManifest | null> {
  try {
    const { id } = JSON.parse(await readFile(pointerPath(platform, runtime), "utf8")) as { id: string };
    if (!validId(id)) return null;
    return JSON.parse(await readFile(path.join(updatesRoot(), "updates", id, "manifest.json"), "utf8")) as StoredManifest;
  } catch {
    return null;
  }
}

function sendMultipart(res: Response, name: "manifest" | "directive", json: unknown) {
  const boundary = `pricebot-${randomUUID()}`;
  const parts = [
    `--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${JSON.stringify(json)}\r\n`,
    ...(name === "manifest" ? [`--${boundary}\r\nContent-Type: application/json\r\nContent-Disposition: form-data; name="extensions"\r\n\r\n${JSON.stringify({ assetRequestHeaders: {} })}\r\n`] : []),
    `--${boundary}--\r\n`,
  ];
  res.status(200).set({
    "expo-protocol-version": "1",
    "expo-sfv-version": "0",
    "Cache-Control": "private, max-age=0",
    "Content-Type": `multipart/mixed; boundary=${boundary}`,
  }).send(Buffer.from(parts.join(""), "utf8"));
}

/**
 * Who may publish: GitHub Actions of this repository's main branch (GitHub's
 * signed OIDC token — no shared secret to manage), or APP_UPDATE_TOKEN if set.
 */
const oidcIssuer = "https://token.actions.githubusercontent.com";
export const updateAudience = "price-bot-updates";
let jwksCache: { at: number; keys: JsonWebKey[] } | null = null;

async function githubKeys(force = false) {
  if (!force && jwksCache && Date.now() - jwksCache.at < 3_600_000) return jwksCache.keys;
  const url = process.env.APP_UPDATE_JWKS_URL ?? `${oidcIssuer}/.well-known/jwks`;
  const response = await fetch(url, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`JWKS ${response.status}`);
  const { keys } = await response.json() as { keys: JsonWebKey[] };
  jwksCache = { at: Date.now(), keys };
  return keys;
}

async function githubActionsOk(token: string) {
  const [head, payload, signature] = token.split(".");
  if (!head || !payload || !signature) return false;
  const header = JSON.parse(Buffer.from(head, "base64url").toString()) as { alg?: string; kid?: string };
  if (header.alg !== "RS256") return false;
  let key = (await githubKeys()).find((item) => (item as { kid?: string }).kid === header.kid);
  if (!key) key = (await githubKeys(true)).find((item) => (item as { kid?: string }).kid === header.kid);
  if (!key) return false;
  const valid = createVerify("RSA-SHA256").update(`${head}.${payload}`).verify(createPublicKey({ key, format: "jwk" }), Buffer.from(signature, "base64url"));
  if (!valid) return false;
  const claims = JSON.parse(Buffer.from(payload, "base64url").toString()) as Record<string, unknown>;
  const now = Date.now() / 1000;
  const repository = process.env.APP_UPDATE_REPOSITORY ?? "miiuz0307-creator/price-bot";
  return claims.iss === (process.env.APP_UPDATE_JWT_ISSUER ?? oidcIssuer)
    && claims.aud === updateAudience
    && typeof claims.exp === "number" && claims.exp > now
    && claims.repository === repository
    && claims.ref === "refs/heads/main";
}

async function tokenOk(req: Request) {
  const given = (req.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const expected = process.env.APP_UPDATE_TOKEN ?? "";
  if (expected.length >= 24 && given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))) return true;
  try {
    return await githubActionsOk(given);
  } catch (error) {
    logger.warn({ err: error }, "Could not verify the update publisher");
    return false;
  }
}

export const appUpdatesRouter: Router = Router();

/** The app asks: is there newer code for my platform + runtime version? */
appUpdatesRouter.get("/manifest", async (req, res, next) => {
  try {
    const platform = String(req.get("expo-platform") ?? req.query.platform ?? "");
    const runtime = String(req.get("expo-runtime-version") ?? req.query["runtime-version"] ?? "");
    const protocol = Number(req.get("expo-protocol-version") ?? 0);
    if (!platforms.has(platform) || !validRuntime(runtime)) {
      res.status(400).json({ error: "expo-platform and expo-runtime-version are required" });
      return;
    }
    const manifest = await currentManifest(platform, runtime);
    if (!manifest || (protocol >= 1 && req.get("expo-current-update-id") === manifest.id)) {
      if (protocol >= 1) sendMultipart(res, "directive", { type: "noUpdateAvailable" });
      else res.status(404).json({ error: "no update" });
      return;
    }
    const base = `${req.protocol}://${req.get("host")}/api/app-updates/assets/${manifest.id}/`;
    const asset = ({ path: relPath, ...rest }: StoredAsset) => ({ ...rest, url: base + relPath.split("/").map(encodeURIComponent).join("/") });
    sendMultipart(res, "manifest", {
      id: manifest.id,
      createdAt: manifest.createdAt,
      runtimeVersion: manifest.runtimeVersion,
      launchAsset: asset(manifest.launchAsset),
      assets: manifest.assets.map(asset),
      metadata: {},
      extra: { expoClient: manifest.expoConfig },
    });
  } catch (error) {
    next(error);
  }
});

appUpdatesRouter.get("/assets/:id/*file", async (req, res, next) => {
  try {
    const id = String(req.params.id);
    const file = ([] as string[]).concat(req.params.file as unknown as string | string[]).join("/");
    const dir = path.join(updatesRoot(), "updates", id);
    const target = path.resolve(dir, file);
    if (!validId(id) || !target.startsWith(dir + path.sep) || !existsSync(target)) {
      res.status(404).end();
      return;
    }
    const manifest = JSON.parse(await readFile(path.join(dir, "manifest.json"), "utf8")) as StoredManifest;
    const entry = [manifest.launchAsset, ...manifest.assets].find((item) => item.path === file);
    res.set({ "Cache-Control": "public, max-age=31536000, immutable", "Content-Type": entry?.contentType ?? "application/octet-stream" });
    res.sendFile(target);
  } catch (error) {
    next(error);
  }
});

/**
 * CI publishes the output of `expo export` (metadata.json + files, base64) with
 * the secret APP_UPDATE_TOKEN. The newest update becomes current for its
 * platform + runtime version; older ones are kept briefly, then removed.
 */
appUpdatesRouter.post("/publish", express.json({ limit: "150mb" }), async (req, res, next) => {
  try {
    if (!(await tokenOk(req))) {
      res.status(401).json({ error: "not allowed to publish updates" });
      return;
    }
    const { platform, runtimeVersion, expoConfig, metadata, files, message } = req.body ?? {};
    const fileMetadata = metadata?.fileMetadata?.[platform];
    if (!platforms.has(platform) || !validRuntime(runtimeVersion) || !fileMetadata?.bundle || typeof files !== "object" || !files) {
      res.status(400).json({ error: "platform, runtimeVersion, metadata.fileMetadata and files are required" });
      return;
    }
    const id = randomUUID();
    const dir = path.join(updatesRoot(), "updates", id);
    const read = (relPath: string) => {
      const encoded = files[relPath];
      if (typeof encoded !== "string") throw Object.assign(new Error(`missing file ${relPath}`), { status: 400 });
      const target = path.resolve(dir, relPath);
      if (!target.startsWith(dir + path.sep)) throw Object.assign(new Error(`bad path ${relPath}`), { status: 400 });
      return { target, data: Buffer.from(encoded, "base64") };
    };
    const entries: { target: string; data: Buffer; asset: StoredAsset }[] = [];
    const bundle = read(fileMetadata.bundle);
    entries.push({ ...bundle, asset: describe(bundle.data, fileMetadata.bundle) });
    for (const item of (fileMetadata.assets ?? []) as { path: string; ext: string }[]) {
      const file = read(item.path);
      entries.push({ ...file, asset: describe(file.data, item.path, item.ext) });
    }
    for (const entry of entries) {
      await mkdir(path.dirname(entry.target), { recursive: true });
      await writeFile(entry.target, entry.data);
    }
    const manifest: StoredManifest = {
      id, createdAt: new Date().toISOString(), runtimeVersion, platform, message: String(message ?? "").slice(0, 300),
      launchAsset: { ...entries[0].asset, contentType: "application/javascript" },
      assets: entries.slice(1).map((entry) => entry.asset),
      expoConfig: expoConfig && typeof expoConfig === "object" ? expoConfig : {},
    };
    await writeFile(path.join(dir, "manifest.json"), JSON.stringify(manifest));
    await mkdir(path.dirname(pointerPath(platform, runtimeVersion)), { recursive: true });
    await writeFile(pointerPath(platform, runtimeVersion), JSON.stringify({ id }));
    logger.info({ id, platform, runtimeVersion, files: entries.length }, "Published app update");
    await pruneOldUpdates().catch((error) => logger.warn({ err: error }, "Unable to prune old app updates"));
    res.status(201).json({ id, platform, runtimeVersion, files: entries.length });
  } catch (error) {
    next(error);
  }
});

/** Keeps the 6 newest updates (and every current one). */
async function pruneOldUpdates() {
  const root = path.join(updatesRoot(), "updates");
  const current = new Set<string>();
  for (const name of await readdir(path.join(updatesRoot(), "current")).catch(() => [] as string[])) {
    try { current.add(JSON.parse(await readFile(path.join(updatesRoot(), "current", name), "utf8")).id); } catch { /* ignore */ }
  }
  const dirs = await Promise.all((await readdir(root)).map(async (name) => ({ name, time: (await stat(path.join(root, name))).mtimeMs })));
  const old = dirs.sort((a, b) => b.time - a.time).slice(6).filter((dir) => !current.has(dir.name));
  for (const dir of old) await rm(path.join(root, dir.name), { recursive: true, force: true });
}
