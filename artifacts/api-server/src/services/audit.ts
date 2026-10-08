import type { Request } from "express";
import { db, priceBotAuditLog } from "@workspace/db";
import { logger } from "../lib/logger";

/**
 * Records who did what. Never throws: a failed audit write must not break the
 * action itself, it is only logged.
 *
 * Action names are "<area>.<verb>", e.g. "user.suspend", "product.update",
 * "whatsapp.disconnected". Problems that the owner should notice use a
 * ".error"/".disconnected"/".failed" suffix (see problemActions).
 */
export async function audit(
  req: Request | null,
  action: string,
  target: { type?: string; id?: string | number } = {},
  details: Record<string, unknown> = {},
  actorId?: number | null,
) {
  try {
    await db.insert(priceBotAuditLog).values({
      actorId: actorId === undefined ? req?.authAdmin?.id ?? null : actorId,
      action,
      targetType: target.type ?? "",
      targetId: target.id === undefined ? "" : String(target.id),
      details,
      ip: req?.ip ?? "",
    });
  } catch (error) {
    logger.warn({ err: error, action }, "Unable to write audit log entry");
  }
}

/** Audit actions shown to the owner as problems/alerts. */
export const problemActionPattern = "%.(error|failed|disconnected|logged_out|replaced|login_failed)";
export const problemActions = /\.(error|failed|disconnected|logged_out|replaced|login_failed)$/u;
