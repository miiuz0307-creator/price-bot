import { Router, type IRouter } from "express";
import { requireAdmin } from "../auth/admin-auth";
import authRouter from "./auth";
import catalogRouter from "./catalog";
import teamRouter from "./team";
import targetsRouter from "./targets";
import lookupsRouter from "./lookups";
import dashboardRouter from "./dashboard";
import surgeRouter from "./surge";
import messageTestRouter from "./message-test";

// Starts the WhatsApp bot (message handler + startup tasks) exactly as before the split.
export { processPriceBotMessage, priceBotReady } from "../bot/engine";

const router: IRouter = Router();

// Public: login, owner setup, session.
router.use(authRouter);
// Everything below requires a signed-in administrator, including the dashboard's
// message-test endpoint (it used to be public and ran as the owner).
router.use(requireAdmin);
router.use(catalogRouter);
router.use(teamRouter);
router.use(targetsRouter);
router.use(lookupsRouter);
router.use(dashboardRouter);
router.use(surgeRouter);
router.use(messageTestRouter);

export default router;
