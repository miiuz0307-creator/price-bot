import { Router, type IRouter } from "express";
import healthRouter from "./health";
import priceBotRouter from "./price-bot";

const router: IRouter = Router();

router.use(healthRouter);
router.use(priceBotRouter);

export default router;
