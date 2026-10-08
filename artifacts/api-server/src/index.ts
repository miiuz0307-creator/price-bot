import { migrationsReady, pool } from "@workspace/db";
import app from "./app";
import { logger } from "./lib/logger";
import { whatsappWeb } from "./services/whatsapp-web";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

// Schema first: never serve requests against an outdated database.
await migrationsReady.catch((err) => {
  logger.fatal({ err }, "Database migration failed; refusing to start");
  process.exit(1);
});

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// On redeploy/restart the platform sends SIGTERM. Close WhatsApp sockets
// without logging out (the saved session stays valid), then the database.
let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Shutting down");
  const forceExit = setTimeout(() => process.exit(1), 10_000);
  forceExit.unref();
  server.close();
  await whatsappWeb.shutdown().catch((err) => logger.warn({ err }, "WhatsApp shutdown failed"));
  await pool.end().catch((err) => logger.warn({ err }, "Database pool shutdown failed"));
  process.exit(0);
}
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.once("SIGINT", () => void shutdown("SIGINT"));

process.on("unhandledRejection", (reason) => {
  logger.error({ err: reason }, "Unhandled promise rejection");
});
