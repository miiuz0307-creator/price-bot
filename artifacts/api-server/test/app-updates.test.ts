/**
 * Over-the-air app updates: publish (token), manifest in Expo Updates protocol
 * format, assets, and "no update" when the phone already runs the newest code.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";

test("app updates: publish, manifest, assets", { timeout: 30_000 }, async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "app-updates-"));
  process.env.APP_UPDATES_DIR = dir;
  process.env.APP_UPDATE_TOKEN = "t".repeat(32);
  const { appUpdatesRouter } = await import("../src/services/app-updates");
  const app = express();
  app.set("trust proxy", 1);
  app.use("/api/app-updates", appUpdatesRouter);
  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/app-updates`;

  const bundle = Buffer.from("console.log('bundle v2')");
  const icon = Buffer.from([137, 80, 78, 71, 1, 2, 3]);
  const body = {
    platform: "android",
    runtimeVersion: "1",
    message: "test",
    expoConfig: { name: "מחירון", extra: { apiUrl: "https://example.test" } },
    metadata: { version: 0, bundler: "metro", fileMetadata: { android: { bundle: "_expo/static/js/android/entry-abc.hbc", assets: [{ path: "assets/0123abcd", ext: "png" }] } } },
    files: { "_expo/static/js/android/entry-abc.hbc": bundle.toString("base64"), "assets/0123abcd": icon.toString("base64") },
  };
  const post = (token: string, payload: unknown = body) => fetch(`${base}/publish`, {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify(payload),
  });
  const manifestRequest = (headers: Record<string, string> = {}) => fetch(`${base}/manifest`, {
    headers: { "expo-platform": "android", "expo-runtime-version": "1", "expo-protocol-version": "1", ...headers },
  });
  const part = async (response: Response, name: string) => {
    const boundary = /boundary=([^;]+)/.exec(response.headers.get("content-type") ?? "")?.[1];
    assert.ok(boundary, "multipart response");
    const text = await response.text();
    const section = text.split(`--${boundary}`).find((chunk) => chunk.includes(`name="${name}"`));
    return section ? JSON.parse(section.slice(section.indexOf("\r\n\r\n") + 4).trim()) : null;
  };

  try {
    // Before anything is published the app is told there is nothing new.
    assert.deepEqual(await part(await manifestRequest(), "directive"), { type: "noUpdateAvailable" });

    assert.equal((await post("wrong-token")).status, 401);
    const published = await post("t".repeat(32));
    assert.equal(published.status, 201);
    const { id } = await published.json() as { id: string };

    const response = await manifestRequest();
    assert.equal(response.headers.get("expo-protocol-version"), "1");
    const manifest = await part(response, "manifest");
    assert.equal(manifest.id, id);
    assert.equal(manifest.runtimeVersion, "1");
    assert.equal(manifest.launchAsset.hash, createHash("sha256").update(bundle).digest("base64url"));
    assert.equal(manifest.launchAsset.contentType, "application/javascript");
    assert.equal(manifest.assets[0].fileExtension, ".png");
    assert.equal(manifest.extra.expoClient.extra.apiUrl, "https://example.test");

    const launch = await fetch(manifest.launchAsset.url);
    assert.equal(launch.status, 200);
    assert.equal(Buffer.from(await launch.arrayBuffer()).toString(), bundle.toString());
    const asset = await fetch(manifest.assets[0].url);
    assert.equal(asset.headers.get("content-type"), "image/png");
    assert.equal((await fetch(`${base}/assets/${id}/..%2F..%2Fsecret`)).status, 404);

    // GitHub Actions (main branch of this repository) may publish with its OIDC token.
    const { generateKeyPairSync, createSign } = await import("node:crypto");
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const jwks = express();
    jwks.get("/jwks", (_req, res) => { res.json({ keys: [{ ...publicKey.export({ format: "jwk" }), kid: "k1", alg: "RS256", use: "sig" }] }); });
    const jwksServer = jwks.listen(0);
    await new Promise((resolve) => jwksServer.once("listening", resolve));
    process.env.APP_UPDATE_JWKS_URL = `http://127.0.0.1:${(jwksServer.address() as AddressInfo).port}/jwks`;
    const jwt = (claims: Record<string, unknown>) => {
      const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
      const unsigned = `${encode({ alg: "RS256", kid: "k1", typ: "JWT" })}.${encode(claims)}`;
      return `${unsigned}.${createSign("RSA-SHA256").update(unsigned).sign(privateKey, "base64url")}`;
    };
    const good = { iss: "https://token.actions.githubusercontent.com", aud: "price-bot-updates", exp: Math.floor(Date.now() / 1000) + 300, repository: "miiuz0307-creator/price-bot", ref: "refs/heads/main" };
    try {
      assert.equal((await post(jwt(good))).status, 201, "main branch of this repository");
      assert.equal((await post(jwt({ ...good, ref: "refs/heads/feature" }))).status, 401, "other branches cannot publish");
      assert.equal((await post(jwt({ ...good, repository: "someone/else" }))).status, 401, "other repositories cannot publish");
      assert.equal((await post(jwt({ ...good, exp: 1 }))).status, 401, "expired token");
    } finally {
      jwksServer.close();
    }
    const latest = await part(await manifestRequest(), "manifest");
    assert.notEqual(latest.id, id, "newest publish is current");

    // A phone already running this update gets "no update".
    assert.deepEqual(await part(await manifestRequest({ "expo-current-update-id": latest.id }), "directive"), { type: "noUpdateAvailable" });
    // Another runtime (an older APK) is not offered code it cannot run.
    assert.deepEqual(await part(await manifestRequest({ "expo-runtime-version": "0" }), "directive"), { type: "noUpdateAvailable" });
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
});
