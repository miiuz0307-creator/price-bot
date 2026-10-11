import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { RegisterPushDeviceBody, RegisterPushDeviceResponse, RemovePushDeviceBody } from "@workspace/api-zod";
import { db, priceBotPushDevices } from "@workspace/db";
import { pushPreferences } from "../services/push";
import { audit } from "../services/audit";

const router: IRouter = Router();

/** The mobile app registers its push token after sign-in (and when preferences change). */
router.post("/push/devices", async (req, res, next) => {
  try {
    const data = RegisterPushDeviceBody.parse(req.body);
    const admin = req.authAdmin!;
    const [existing] = await db.select().from(priceBotPushDevices).where(eq(priceBotPushDevices.token, data.token));
    const preferences = pushPreferences(data.preferences ?? existing?.preferences);
    const now = new Date();
    // A phone belongs to whoever signed in on it last.
    const [device] = await db.insert(priceBotPushDevices)
      .values({ adminId: admin.id, token: data.token, platform: data.platform, preferences, lastSeenAt: now })
      .onConflictDoUpdate({ target: priceBotPushDevices.token, set: { adminId: admin.id, platform: data.platform, preferences, lastSeenAt: now } })
      .returning();
    if (!existing || existing.adminId !== admin.id) void audit(req, "push.device_registered", { type: "user", id: admin.id }, { platform: data.platform });
    res.json(RegisterPushDeviceResponse.parse({ token: device.token, platform: device.platform, preferences: pushPreferences(device.preferences) }));
  } catch (error) {
    next(error);
  }
});

router.post("/push/devices/remove", async (req, res, next) => {
  try {
    const data = RemovePushDeviceBody.parse(req.body);
    await db.delete(priceBotPushDevices).where(eq(priceBotPushDevices.token, data.token));
    res.status(204).end();
  } catch (error) {
    next(error);
  }
});

export default router;
