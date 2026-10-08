import express, { type ErrorRequestHandler, type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

// Hosting platforms (Replit, Railway, Render, nginx) put one proxy in front of
// the app; trust it so req.ip is the real client for login rate limiting.
app.set("trust proxy", Number(process.env.TRUST_PROXY_HOPS ?? 1));
app.disable("x-powered-by");

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors({ credentials: true, origin: true }));
app.use(cookieParser());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

// Validation problems are the caller's fault (400); anything else is logged with
// full detail on the server and answered with a generic message.
const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const error = err as { name?: string; status?: number; statusCode?: number; type?: string };
  const status = error?.status ?? error?.statusCode;
  if (error?.name === "ZodError" || error?.type === "entity.parse.failed" || (status && status >= 400 && status < 500)) {
    res.status(status && status >= 400 && status < 500 ? status : 400).json({ error: "הנתונים שנשלחו אינם תקינים." });
    return;
  }
  req.log.error({ err }, "Unhandled request error");
  if (res.headersSent) return;
  res.status(500).json({ error: "אירעה שגיאה בשרת. נסו שוב בעוד רגע." });
};
app.use(errorHandler);

export default app;
