import { eq } from "@agent-native/core/db/schema";
import { getDb } from "../db/index.js";
import { personas, segments } from "../db/schema.js";
import { getUserRole } from "./require-role.js";

type Db = ReturnType<typeof getDb>;

export class SegmentAccessError extends Error {
  statusCode: number;
  constructor(message: string, statusCode = 403) {
    super(message);
    this.name = "SegmentAccessError";
    this.statusCode = statusCode;
  }
}

/**
 * Row-level security rule 1: a segment is visible if the requester owns it,
 * OR it's public, OR the requester is a manager (admin).
 */
export async function assertSegmentReadable(
  segmentId: string,
  requesterEmail: string,
  db: Db,
): Promise<typeof segments.$inferSelect> {
  const [segment] = await db.select().from(segments).where(eq(segments.id, segmentId)).limit(1);
  if (!segment) throw new SegmentAccessError("Segment not found.", 404);

  const role = await getUserRole(requesterEmail);
  const allowed = segment.ownerEmail === requesterEmail || segment.visibility === "public" || role === "admin";
  if (!allowed) throw new SegmentAccessError("You don't have access to this segment.");
  return segment;
}

/**
 * Row-level security rule 2: only the owner (or a manager) can modify a
 * segment. Rule 3: only managers can set assigned_to — callers should check
 * `role !== "admin"` themselves before allowing an assignedToEmail change,
 * since the action layer knows which fields are actually being patched.
 */
export async function assertSegmentWritable(
  segmentId: string,
  requesterEmail: string,
  db: Db,
): Promise<{ segment: typeof segments.$inferSelect; role: Awaited<ReturnType<typeof getUserRole>> }> {
  const [segment] = await db.select().from(segments).where(eq(segments.id, segmentId)).limit(1);
  if (!segment) throw new SegmentAccessError("Segment not found.", 404);

  const role = await getUserRole(requesterEmail);
  if (segment.ownerEmail !== requesterEmail && role !== "admin") {
    throw new SegmentAccessError("Only the segment owner or a manager can modify this segment.");
  }
  return { segment, role };
}

/**
 * Row-level security rule 5 (persona half): core persona records are
 * editable by managers only.
 */
export async function assertPersonaWritable(
  personaId: string,
  requesterEmail: string,
  db: Db,
): Promise<typeof personas.$inferSelect> {
  const [persona] = await db.select().from(personas).where(eq(personas.id, personaId)).limit(1);
  if (!persona) throw new SegmentAccessError("Persona not found.", 404);

  const role = await getUserRole(requesterEmail);
  if (role !== "admin") {
    throw new SegmentAccessError("Only a manager can edit core persona documentation.");
  }
  return persona;
}
