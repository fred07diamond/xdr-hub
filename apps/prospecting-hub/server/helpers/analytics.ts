import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { analyticsEvents } from "../db/schema.js";

export async function logAnalyticsEvent(
  userEmail: string,
  eventType: "segment_created" | "contact_actioned" | "sync_run",
  metadata?: Record<string, unknown>,
): Promise<void> {
  const db = getDb();
  await db.insert(analyticsEvents).values({
    id: nanoid(),
    userEmail,
    eventType,
    metadata: metadata ? JSON.stringify(metadata) : null,
    timestamp: new Date().toISOString(),
  });
}
