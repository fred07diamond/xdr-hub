import { eq, isNull, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { messagingCanvases, messagingNodes } from "../db/schema.js";

// Stable IDs — hardcoded so they never drift between deploys.
export const SYSTEM_CANVAS_IDS = {
  account:  "sys-canvas-account",
  role:     "sys-canvas-role",
  prospect: "sys-canvas-prospect",
  blank:    "sys-canvas-blank",
} as const;

type SystemSlug = keyof typeof SYSTEM_CANVAS_IDS;

const SYSTEM_TEMPLATES: Array<{
  slug: SystemSlug;
  name: string;
  nodes: Array<{ type: string; title: string; positionX: number; positionY: number }>;
}> = [
  {
    slug: "account",
    name: "Account Messaging",
    nodes: [
      { type: "company",     title: "Company",     positionX: 100, positionY: 100 },
      { type: "tone",        title: "Tone & Voice", positionX: 380, positionY: 60  },
      { type: "tone",        title: "Value Props",  positionX: 380, positionY: 270 },
      { type: "phrase_rule", title: "Phrase Rules", positionX: 660, positionY: 160 },
    ],
  },
  {
    slug: "role",
    name: "Role Messaging",
    nodes: [
      { type: "role",        title: "Role / Title", positionX: 100, positionY: 100 },
      { type: "tone",        title: "Tone & Voice", positionX: 380, positionY: 60  },
      { type: "tone",        title: "Value Props",  positionX: 380, positionY: 270 },
      { type: "phrase_rule", title: "Phrase Rules", positionX: 660, positionY: 160 },
      { type: "example",     title: "Example Note", positionX: 660, positionY: 370 },
    ],
  },
  {
    slug: "prospect",
    name: "Prospect Messaging",
    nodes: [
      { type: "persona",     title: "Persona",      positionX: 100, positionY: 100 },
      { type: "tone",        title: "Tone & Voice", positionX: 380, positionY: 60  },
      { type: "phrase_rule", title: "Phrase Rules", positionX: 380, positionY: 270 },
      { type: "example",     title: "Example Note", positionX: 660, positionY: 160 },
    ],
  },
  {
    slug: "blank",
    name: "Blank",
    nodes: [],
  },
];

export async function seedSystemCanvases(db: ReturnType<typeof getDb>): Promise<void> {
  for (const template of SYSTEM_TEMPLATES) {
    const canvasId = SYSTEM_CANVAS_IDS[template.slug];

    const existing = await db
      .select({ id: messagingCanvases.id })
      .from(messagingCanvases)
      .where(eq(messagingCanvases.id, canvasId))
      .limit(1);

    if (existing.length > 0) continue; // already seeded

    const now = new Date().toISOString();

    await db.insert(messagingCanvases).values({
      id: canvasId,
      name: template.name,
      templateSlug: template.slug,
      isSystem: 1,
      ownerEmail: null,
      createdAt: now,
      updatedAt: now,
    });

    for (const n of template.nodes) {
      await db.insert(messagingNodes).values({
        id: nanoid(),
        type: n.type,
        title: n.title,
        ownerEmail: null,
        canvasId,
        positionX: n.positionX,
        positionY: n.positionY,
        createdAt: now,
        updatedAt: now,
      });
    }
  }
}

/**
 * Ensure a user has at least one canvas. If they have existing nodes with no
 * canvas_id, create a "My Canvas" for them and backfill those nodes into it.
 */
export async function ensureUserCanvas(
  ownerEmail: string,
  db: ReturnType<typeof getDb>,
): Promise<string> {
  const existing = await db
    .select({ id: messagingCanvases.id })
    .from(messagingCanvases)
    .where(and(eq(messagingCanvases.ownerEmail, ownerEmail), eq(messagingCanvases.isSystem, 0)))
    .limit(1);

  if (existing[0]) return existing[0].id;

  // Create default canvas
  const canvasId = nanoid();
  const now = new Date().toISOString();
  await db.insert(messagingCanvases).values({
    id: canvasId,
    name: "My Canvas",
    templateSlug: null,
    isSystem: 0,
    ownerEmail,
    createdAt: now,
    updatedAt: now,
  });

  // Backfill existing nodes that belong to this user but have no canvas_id
  await db
    .update(messagingNodes)
    .set({ canvasId, updatedAt: now })
    .where(and(eq(messagingNodes.ownerEmail, ownerEmail), isNull(messagingNodes.canvasId)));

  return canvasId;
}
