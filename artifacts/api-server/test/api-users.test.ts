/**
 * End-to-end API tests for accounts, permissions and sessions.
 * Starts the real Express app on a random port against the CI PostgreSQL.
 */
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import test from "node:test";

type Json = Record<string, any>;

test("users, permissions, sessions and sign-in", { timeout: 120_000 }, async (t) => {
  const { db, pool, priceBotAdmins, priceBotLoginCodes, priceBotTargets, migrationsReady } = await import("@workspace/db") as Record<string, any>;
  const { eq, inArray } = await import("drizzle-orm");
  await migrationsReady;
  const { default: app } = await import("../src/app");
  const { priceBotReady } = await import("../src/routes/price-bot") as Record<string, any>;
  await priceBotReady;
  const { hashCode } = await import("../src/auth/admin-auth");
  const { getOrCreateOwnerAdmin } = await import("../src/services/owner");
  const { whatsappWeb } = await import("../src/services/whatsapp-web");

  const server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;

  async function call(method: string, path: string, body?: unknown, cookie?: string) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: { ...(body === undefined ? {} : { "content-type": "application/json" }), ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = response.headers.getSetCookie().find((value) => value.startsWith("price_bot_session="));
    const text = await response.text();
    return { status: response.status, json: (text ? JSON.parse(text) : null) as Json, cookie: setCookie?.split(";")[0] };
  }

  const createdPhones = ["0531112222", "0532223333"];
  const owner = await getOrCreateOwnerAdmin();
  await db.update(priceBotAdmins).set({ codeHash: await hashCode("2468") }).where(eq(priceBotAdmins.id, owner.id));
  await db.delete(priceBotAdmins).where(inArray(priceBotAdmins.phone, createdPhones));

  let ownerCookie = "";
  let danaCookie = "";
  let danaId = 0;

  await t.test("everything except sign-in requires a session", async () => {
    assert.equal((await call("GET", "/products")).status, 401);
    assert.equal((await call("POST", "/webhooks/whatsapp", { from: "972500000000", body: "מ בב ים" })).status, 401);
    assert.equal((await call("GET", "/auth/session", undefined, "price_bot_session=forged")).status, 401);
  });

  await t.test("owner signs in with phone + personal code", async () => {
    const result = await call("POST", "/auth/pin", { identifier: "050-410-7826", code: "2468" });
    assert.equal(result.status, 200, JSON.stringify(result.json));
    assert.ok(result.cookie, "session cookie set");
    ownerCookie = result.cookie!;
    const session = await call("GET", "/auth/session", undefined, ownerCookie);
    assert.equal(session.json.admin.role, "owner");
    assert.ok(session.json.admin.permissions.includes("users.manage"));
    assert.ok(session.json.admin.lastLoginAt);
  });

  await t.test("owner adds a user who shares the owner's WhatsApp", async () => {
    const created = await call("POST", "/admins", {
      phone: createdPhones[0], label: "דנה", email: "Dana@Example.com", permissions: ["targets.manage", "users.manage"], sharedWhatsapp: true,
    }, ownerCookie);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    danaId = created.json.id;
    assert.equal(created.json.email, "dana@example.com");
    assert.equal(created.json.sharedWhatsapp, true);
    assert.equal(created.json.whatsappOwnerId, owner.id);
    assert.deepEqual([...created.json.permissions].sort(), ["targets.manage", "users.manage"]);
    assert.equal((await call("PUT", `/admins/${danaId}/code`, { code: "1357" }, ownerCookie)).status, 204);
  });

  await t.test("user signs in by e-mail and sees only herself", async () => {
    const login = await call("POST", "/auth/pin", { identifier: "DANA@example.com", code: "1357" });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    danaCookie = login.cookie!;
    // She holds users.manage, so she sees the team; drop it and she only sees herself.
    const narrowed = await call("PATCH", `/admins/${danaId}`, { permissions: ["targets.manage"] }, ownerCookie);
    assert.equal(narrowed.status, 200, JSON.stringify(narrowed.json));
    const list = await call("GET", "/admins", undefined, danaCookie);
    assert.equal(list.status, 200);
    assert.deepEqual(list.json.map((row: Json) => row.id), [danaId]);
  });

  await t.test("permissions are enforced and the workspace is shared", async () => {
    const product = await call("POST", "/products", { name: "טסט ⇔ בדיקה", price: 100 }, danaCookie);
    assert.equal(product.status, 403);
    assert.match(product.json.error, /עריכת מחירון/u);
    assert.equal((await call("POST", "/integration/whatsapp/connect", undefined, danaCookie)).status, 403);
    assert.equal((await call("POST", "/admins", { phone: createdPhones[1] }, danaCookie)).status, 403);
    const target = await call("POST", "/targets", { kind: "contact", identifier: "0541234567", label: "לקוח משותף" }, danaCookie);
    assert.equal(target.status, 201, JSON.stringify(target.json));
    const ownerTargets = await call("GET", "/targets", undefined, ownerCookie);
    assert.ok(ownerTargets.json.some((row: Json) => row.id === target.json.id), "target lands in the owner's workspace");
    await db.delete(priceBotTargets).where(eq(priceBotTargets.id, target.json.id));
  });

  await t.test("nobody but the owner can change the owner", async () => {
    assert.equal((await call("PATCH", `/admins/${danaId}`, { permissions: ["targets.manage", "users.manage"] }, ownerCookie)).status, 200);
    const relogin = await call("POST", "/auth/pin", { identifier: "dana@example.com", code: "1357" });
    const attempt = await call("PATCH", `/admins/${owner.id}`, { active: false }, relogin.cookie);
    assert.equal(attempt.status, 403);
    const escalate = await call("POST", "/admins", { phone: createdPhones[1], label: "מתחזה", permissions: ["users.manage"] }, relogin.cookie);
    assert.equal(escalate.status, 201);
    assert.ok(!escalate.json.permissions.includes("users.manage"), "only the owner grants user management");
    await call("DELETE", `/admins/${escalate.json.id}`, undefined, ownerCookie);
  });

  await t.test("suspending a user signs them out immediately", async () => {
    const suspended = await call("PATCH", `/admins/${danaId}`, { active: false }, ownerCookie);
    assert.equal(suspended.status, 200);
    assert.equal(suspended.json.active, false);
    assert.equal((await call("GET", "/auth/session", undefined, danaCookie)).status, 401);
    assert.equal((await call("POST", "/auth/pin", { identifier: "dana@example.com", code: "1357" })).status, 401);
    assert.equal((await call("PATCH", `/admins/${danaId}`, { active: true }, ownerCookie)).json.active, true);
  });

  await t.test("one-time WhatsApp code: undeliverable without a connection, single use when valid", async () => {
    const unknown = await call("POST", "/auth/code/request", { identifier: "0599999999" });
    assert.equal(unknown.status, 200);
    assert.deepEqual(unknown.json, { sent: true, destination: null });
    const noConnection = await call("POST", "/auth/code/request", { identifier: createdPhones[0] });
    assert.equal(noConnection.status, 503);
    // Simulate a delivered code.
    await db.insert(priceBotLoginCodes).values({ adminId: danaId, codeHash: await hashCode("654321"), expiresAt: new Date(Date.now() + 60_000) });
    assert.equal((await call("POST", "/auth/code/verify", { identifier: createdPhones[0], code: "111111" })).status, 401);
    const ok = await call("POST", "/auth/code/verify", { identifier: createdPhones[0], code: "654321" });
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.ok(ok.cookie);
    assert.equal((await call("POST", "/auth/code/verify", { identifier: createdPhones[0], code: "654321" })).status, 401, "codes are single use");
    // Sign out everywhere.
    assert.equal((await call("POST", `/admins/${danaId}/sessions/revoke`, undefined, ownerCookie)).status, 204);
    assert.equal((await call("GET", "/auth/session", undefined, ok.cookie)).status, 401);
  });

  await t.test("activity log and owner overview", async () => {
    const log = await call("GET", "/audit-log?limit=100", undefined, ownerCookie);
    assert.equal(log.status, 200);
    const actions = new Set(log.json.map((row: Json) => row.action));
    for (const action of ["auth.login", "user.create", "user.suspend", "user.restore", "user.sessions_revoked", "auth.login_failed"]) {
      assert.ok(actions.has(action), `audit has ${action}`);
    }
    const overview = await call("GET", "/system/overview", undefined, ownerCookie);
    assert.equal(overview.status, 200, JSON.stringify(overview.json));
    assert.ok(overview.json.activeUsers >= 2);
    assert.ok(overview.json.connections.some((row: Json) => row.adminId === owner.id && row.sharedUsers >= 1));
  });

  await t.test("mobile app: bearer token sign-in and push devices", async () => {
    const { priceBotPushDevices } = await import("@workspace/db") as Record<string, any>;
    const { notifyWorkspace } = await import("../src/services/push");
    const http = await import("node:http");
    const mobile = async (method: string, path: string, body?: unknown, token?: string) => {
      const response = await fetch(`${base}${path}`, {
        method,
        headers: {
          "x-price-bot-client": "mobile",
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      const text = await response.text();
      return { status: response.status, json: (text ? JSON.parse(text) : null) as Json };
    };

    const web = await call("POST", "/auth/pin", { identifier: "0504107826", code: "2468" });
    assert.equal(web.status, 200);
    assert.equal(web.json.token, undefined, "browsers never receive the token");

    const login = await mobile("POST", "/auth/pin", { identifier: "0504107826", code: "2468" });
    assert.equal(login.status, 200, JSON.stringify(login.json));
    const token = login.json.token as string;
    assert.ok(token && token.length >= 40);
    assert.equal((await mobile("GET", "/auth/session", undefined, token)).json.admin.id, owner.id);
    assert.equal((await mobile("GET", "/products", undefined, token)).status, 200);
    assert.equal((await mobile("GET", "/auth/session", undefined, "x".repeat(43))).status, 401);

    const pushToken = "ExponentPushToken[test-device-0001]";
    await db.delete(priceBotPushDevices).where(eq(priceBotPushDevices.token, pushToken));
    const registered = await mobile("POST", "/push/devices", { token: pushToken, platform: "android" }, token);
    assert.equal(registered.status, 200, JSON.stringify(registered.json));
    assert.deepEqual(registered.json.preferences, { lookups: true, whatsapp: true, surge: false });
    const updated = await mobile("POST", "/push/devices", { token: pushToken, platform: "android", preferences: { lookups: true, whatsapp: false, surge: true } }, token);
    assert.equal(updated.json.preferences.surge, true);

    // Fake Expo push service: records messages and reports the device as gone.
    const received: Json[] = [];
    const fcmReceived: Json[] = [];
    const fake = http.createServer((req, res) => {
      let raw = "";
      req.on("data", (chunk) => { raw += chunk; });
      req.on("end", () => {
        res.setHeader("content-type", "application/json");
        if (req.url === "/token") {
          assert.match(raw, /grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer/);
          res.end(JSON.stringify({ access_token: "fake-access", expires_in: 3600 }));
          return;
        }
        if (req.url === "/fcm") {
          assert.equal(req.headers.authorization, "Bearer fake-access");
          fcmReceived.push(JSON.parse(raw).message);
          res.end("{}");
          return;
        }
        const messages = JSON.parse(raw) as Json[];
        received.push(...messages);
        res.end(JSON.stringify({ data: messages.map(() => ({ status: "error", details: { error: "DeviceNotRegistered" } })) }));
      });
    });
    await new Promise((resolve) => fake.listen(0, () => resolve(null)));
    process.env.EXPO_PUSH_URL = `http://127.0.0.1:${(fake.address() as AddressInfo).port}/send`;
    try {
      await notifyWorkspace(owner.id, "whatsapp", { title: "x", body: "y" });
      assert.equal(received.length, 0, "muted kind is not sent");
      await notifyWorkspace(owner.id, "lookups", { title: "בקשת מחיר חדשה", body: "דימונה ערד", data: { screen: "requests" } });
      assert.equal(received.length, 1);
      assert.equal(received[0].to, pushToken);
      assert.equal(received[0].data.kind, "lookups");
      const left = await db.select().from(priceBotPushDevices).where(eq(priceBotPushDevices.token, pushToken));
      assert.equal(left.length, 0, "unregistered devices are removed");

      // Android phones register their Firebase token; the server signs in with a service account.
      const { generateKeyPairSync } = await import("node:crypto");
      const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
      const fakeBase = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
      process.env.FIREBASE_SERVICE_ACCOUNT = JSON.stringify({
        project_id: "demo", client_email: "push@demo.iam.gserviceaccount.com",
        private_key: privateKey.export({ type: "pkcs8", format: "pem" }), token_uri: `${fakeBase}/token`,
      });
      process.env.FCM_SEND_URL = `${fakeBase}/fcm`;
      const fcmToken = "fcm:APA91b-test-device-token-0002";
      await db.delete(priceBotPushDevices).where(eq(priceBotPushDevices.token, fcmToken));
      assert.equal((await mobile("POST", "/push/devices", { token: fcmToken, platform: "android" }, token)).status, 200);
      await notifyWorkspace(owner.id, "whatsapp", { title: "WhatsApp חובר מחדש", body: "הבוט חזר לענות.", data: { screen: "whatsapp" } });
      assert.equal(fcmReceived.length, 1);
      assert.equal(fcmReceived[0].token, fcmToken);
      assert.equal(fcmReceived[0].notification.title, "WhatsApp חובר מחדש");
      assert.equal(fcmReceived[0].data.screen, "whatsapp");
      await db.delete(priceBotPushDevices).where(eq(priceBotPushDevices.token, fcmToken));
    } finally {
      delete process.env.EXPO_PUSH_URL;
      delete process.env.FIREBASE_SERVICE_ACCOUNT;
      delete process.env.FCM_SEND_URL;
      fake.close();
    }

    assert.equal((await mobile("POST", "/auth/logout", undefined, token)).status, 204);
    assert.equal((await mobile("GET", "/auth/session", undefined, token)).status, 401);
  });

  await t.test("live sync: open screens hear about changes immediately", async () => {
    const controller = new AbortController();
    const stream = await fetch(`${base}/live`, { headers: { cookie: ownerCookie }, signal: controller.signal });
    assert.equal(stream.status, 200);
    assert.match(stream.headers.get("content-type") ?? "", /text\/event-stream/);
    const reader = stream.body!.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const waitFor = async (pattern: RegExp) => {
      const deadline = Date.now() + 5000;
      while (!pattern.test(received) && Date.now() < deadline) {
        const chunk = await Promise.race([reader.read(), new Promise<null>((resolve) => setTimeout(() => resolve(null), 500))]);
        if (chunk && !chunk.done) received += decoder.decode(chunk.value, { stream: true });
      }
      return pattern.test(received);
    };
    assert.ok(await waitFor(/event: ready/), "stream opens");
    const created = await call("POST", "/abbreviations", { shortcut: "בדק", expansion: "בדיקת סנכרון" }, ownerCookie);
    assert.equal(created.status, 201, JSON.stringify(created.json));
    assert.ok(await waitFor(/event: invalidate\ndata: \{"topics":\["catalog"\]\}/), `got: ${received}`);
    await call("DELETE", `/abbreviations/${created.json.id}`, undefined, ownerCookie);
    await reader.cancel().catch(() => undefined);
    controller.abort();
    const anonymous = await fetch(`${base}/live`);
    assert.equal(anonymous.status, 401, "requires sign-in");
    await anonymous.text();
    const { liveClientCount } = await import("../src/services/live");
    for (let i = 0; i < 20 && liveClientCount() > 0; i += 1) await new Promise((resolve) => setTimeout(resolve, 100));
    assert.equal(liveClientCount(), 0, "closed streams are released");
  });

  await t.test("logout ends the session", async () => {
    assert.equal((await call("POST", "/auth/logout", undefined, ownerCookie)).status, 204);
    assert.equal((await call("GET", "/auth/session", undefined, ownerCookie)).status, 401);
  });

  await t.test("brute force is locked out", async () => {
    let last = 0;
    for (let attempt = 0; attempt < 8; attempt += 1) last = (await call("POST", "/auth/pin", { identifier: "0504107826", code: "0000" })).status;
    assert.equal(last, 429);
  });

  await db.delete(priceBotAdmins).where(inArray(priceBotAdmins.phone, createdPhones));
  await whatsappWeb.shutdown();
  server.closeAllConnections();
  server.close();
  await pool.end();
});
