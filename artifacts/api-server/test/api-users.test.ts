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
  server.close();
  await pool.end();
});
