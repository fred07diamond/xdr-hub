import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { messagingCanvases, messagingNodes } from "../db/schema.js";

type Db = ReturnType<typeof getDb>;

export class CanvasAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CanvasAccessError";
  }
}

/**
 * A canvas is readable if the caller owns it OR it's a shared system
 * template (isSystem === 1) — matches the precedent already used in
 * capture-profile.ts for pulling drafting context.
 */
export async function assertCanvasReadable(
  canvasId: string,
  ownerEmail: string | null | undefined,
  db: Db,
): Promise<void> {
  const rows = await db
    .select({ isSystem: messagingCanvases.isSystem, ownerEmail: messagingCanvases.ownerEmail })
    .from(messagingCanvases)
    .where(eq(messagingCanvases.id, canvasId))
    .limit(1);
  const canvas = rows[0];
  const allowed = !!canvas && (canvas.isSystem === 1 || canvas.ownerEmail === ownerEmail);
  if (!allowed) throw new CanvasAccessError("Canvas not found or not accessible.");
}

/**
 * A canvas is writable ONLY if the caller owns it. System canvases are
 * deliberately NOT writable through this path — they're a shared library
 * every user reads from and drafts against, so letting any authenticated
 * user write to one would let them bias every other user's future drafts.
 */
export async function assertCanvasWritable(
  canvasId: string,
  ownerEmail: string | null | undefined,
  db: Db,
): Promise<void> {
  const rows = await db
    .select({ ownerEmail: messagingCanvases.ownerEmail })
    .from(messagingCanvases)
    .where(eq(messagingCanvases.id, canvasId))
    .limit(1);
  const canvas = rows[0];
  if (!canvas || !ownerEmail || canvas.ownerEmail !== ownerEmail) {
    throw new CanvasAccessError("Canvas not found or not writable.");
  }
}

/**
 * A messaging node is writable only by the user it belongs to — mirrors the
 * check already done correctly in update-messaging-node.ts for owned
 * (non-global/persona) node types.
 */
export async function assertNodeWritable(
  nodeId: string,
  ownerEmail: string | null | undefined,
  db: Db,
): Promise<void> {
  const rows = await db
    .select({ ownerEmail: messagingNodes.ownerEmail })
    .from(messagingNodes)
    .where(eq(messagingNodes.id, nodeId))
    .limit(1);
  const node = rows[0];
  if (!node || !ownerEmail || node.ownerEmail !== ownerEmail) {
    throw new CanvasAccessError("Node not found or not writable.");
  }
}
