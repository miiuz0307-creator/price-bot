import type { Request, RequestHandler, Response } from "express";
import { logger } from "../lib/logger";

/**
 * Live sync: every open website / phone app keeps one Server-Sent-Events stream.
 * When anything changes (a manager edits a price, the bot saves a request, WhatsApp
 * connects…) the server tells all of them which data to reload — within a second,
 * instead of waiting for the next periodic refresh.
 */
export type LiveTopic = "catalog" | "requests" | "targets" | "surge" | "users" | "whatsapp";

const clients = new Set<Response>();
let pending = new Set<LiveTopic>();
let flushTimer: NodeJS.Timeout | null = null;

export function publish(topics: LiveTopic[]) {
  if (!topics.length) return;
  for (const topic of topics) pending.add(topic);
  // Coalesce bursts (e.g. a bulk import) into one message.
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    const message = `event: invalidate\ndata: ${JSON.stringify({ topics: [...pending] })}\n\n`;
    pending = new Set();
    for (const res of clients) res.write(message);
  }, 250);
}

export const liveClientCount = () => clients.size;

/** GET /api/live — requires a signed-in user (cookie or Bearer token). */
export const liveStream: RequestHandler = (req: Request, res: Response) => {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-store, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();
  res.write(`retry: 3000\nevent: ready\ndata: {}\n\n`);
  clients.add(res);
  // Keep proxies from closing an idle stream.
  const heartbeat = setInterval(() => res.write(": ping\n\n"), 25_000);
  heartbeat.unref();
  // "close" on the response fires when the connection goes away (the request's
  // own "close" can fire as soon as a GET has been read).
  res.on("close", () => {
    clearInterval(heartbeat);
    clients.delete(res);
  });
  req.socket.setTimeout(0);
};

/** Which data a successful change (POST/PATCH/PUT/DELETE) under /api affects. */
export function topicsForChange(path: string): LiveTopic[] {
  if (/^\/(products|abbreviations)\b/.test(path)) return ["catalog"];
  if (/^\/lookup-requests\b/.test(path)) return ["requests", "catalog"];
  if (/^\/webhooks\/whatsapp\b/.test(path)) return ["requests", "catalog"];
  if (/^\/targets\b/.test(path)) return ["targets"];
  if (/^\/surge\b/.test(path)) return ["surge"];
  if (/^\/admins\b/.test(path)) return ["users"];
  if (/^\/integration\/whatsapp\b/.test(path)) return ["whatsapp"];
  return [];
}

/** Publishes after every successful change made through the API. */
export const publishChanges: RequestHandler = (req, res, next) => {
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "OPTIONS") {
    res.on("finish", () => {
      if (res.statusCode < 400) {
        try { publish(topicsForChange(req.path)); } catch (error) { logger.warn({ err: error }, "Live publish failed"); }
      }
    });
  }
  next();
};
