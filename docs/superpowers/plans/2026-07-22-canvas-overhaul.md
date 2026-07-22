# Canvas Overhaul Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a multi-canvas tab system, 4 universal starter templates, a Company node with live research, an extension canvas picker, a message preview panel, a right-click AI node menu, and a hover-delete UX to the Builder.LI messaging canvas.

**Architecture:** Add a `messaging_canvases` table and a `canvas_id` FK on existing `messaging_nodes`/`messaging_edges` rows. System templates are seeded at startup as `is_system=1` canvases. All existing per-user graph queries gain an optional `canvas_id` filter. The extension selects a canvas before drafting and sends its `canvas_id` to `capture-profile`.

**Tech Stack:** React + @xyflow/react for canvas, Agent Native `defineAction` / `sendToAgentChat` for server actions and AI, Drizzle ORM (provider-agnostic operators only), shadcn/ui + @tabler/icons-react for UI. Migrations via `runMigrations` in `server/plugins/db.ts`. TypeScript throughout.

## Global Constraints

- Never import from `drizzle-orm/sqlite-core` or `drizzle-orm/pg-core` — use `@agent-native/core/db/schema` helpers and portable `drizzle-orm` operators only
- All AI operations go through `sendToAgentChat` — no direct model calls
- UI uses shadcn/ui components and `@tabler/icons-react` — no lucide-react
- All new actions follow existing `defineAction` pattern in `apps/outreach/actions/`
- `deleteKeyCode={["Delete", "Backspace"]}` is already wired in ReactFlow — keyboard delete is already functional, do not re-implement it
- The migration table is `outreach_migrations`; next migration version is **31**
- Node types `persona` and `global` are protected — cannot be deleted by users

---

## File Map

**New files:**
- `apps/outreach/server/helpers/seed-system-canvases.ts` — idempotent seeder for 4 system canvases
- `apps/outreach/server/helpers/build-canvas-context.ts` — canvas-scoped messaging context builder
- `apps/outreach/actions/list-canvases.ts`
- `apps/outreach/actions/create-canvas.ts`
- `apps/outreach/actions/rename-canvas.ts`
- `apps/outreach/actions/delete-canvas.ts`
- `apps/outreach/app/components/canvas/CanvasTabBar.tsx`
- `apps/outreach/app/components/canvas/TemplatePicker.tsx`
- `apps/outreach/app/components/canvas/PreviewPanel.tsx`
- `apps/outreach/app/components/canvas/NodeContextMenu.tsx`

**Modified files:**
- `apps/outreach/server/db/schema.ts` — add `messagingCanvases`, `canvas_id` fields
- `apps/outreach/server/plugins/db.ts` — migrations 31–35
- `apps/outreach/server/plugins/auth.ts` — add `list-canvases` to publicPaths
- `apps/outreach/actions/get-messaging-graph.ts` — accept + filter by `canvasId`
- `apps/outreach/actions/create-messaging-node.ts` — accept `canvasId`, add `company` type
- `apps/outreach/actions/create-messaging-edge.ts` — accept `canvasId`
- `apps/outreach/actions/delete-messaging-node.ts` — allow deleting `company` nodes
- `apps/outreach/actions/capture-profile.ts` — accept `canvasId`, use canvas context
- `apps/outreach/app/routes/messaging.tsx` — tab bar, company node, preview, context menu, hover delete

---

## Task 1: Schema additions and migrations

**Files:**
- Modify: `apps/outreach/server/db/schema.ts`
- Modify: `apps/outreach/server/plugins/db.ts`

**Interfaces:**
- Produces: `messagingCanvases` Drizzle table, `canvas_id` columns on `messagingNodes` and `messagingEdges`, exported type `MessagingCanvas`

- [ ] **Step 1: Add the `messagingCanvases` table to schema.ts**

Open `apps/outreach/server/db/schema.ts` and add after the `messagingEdges` table definition:

```typescript
export const messagingCanvases = table("messaging_canvases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  templateSlug: text("template_slug"),      // "account" | "role" | "prospect" | "blank" | null
  isSystem: integer("is_system").notNull().default(0),
  ownerEmail: text("owner_email"),           // null for system templates
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});
```

- [ ] **Step 2: Add `canvas_id` columns to existing tables in schema.ts**

In the `messagingNodes` table definition add `canvasId: text("canvas_id"),` as a nullable column.
In the `messagingEdges` table definition add `canvasId: text("canvas_id"),` as a nullable column.

- [ ] **Step 3: Add migrations 31–35 to db.ts**

Append to the migrations array in `apps/outreach/server/plugins/db.ts`:

```typescript
{
  version: 31,
  sql: `CREATE TABLE IF NOT EXISTS messaging_canvases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    template_slug TEXT,
    is_system INTEGER NOT NULL DEFAULT 0,
    owner_email TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
},
{ version: 32, sql: `ALTER TABLE messaging_nodes ADD COLUMN canvas_id TEXT` },
{ version: 33, sql: `ALTER TABLE messaging_edges ADD COLUMN canvas_id TEXT` },
{
  version: 34,
  sql: `CREATE INDEX IF NOT EXISTS messaging_nodes_canvas ON messaging_nodes(canvas_id)`,
},
{
  version: 35,
  sql: `CREATE INDEX IF NOT EXISTS messaging_edges_canvas ON messaging_edges(canvas_id)`,
},
```

- [ ] **Step 4: Start dev server and verify migrations run without error**

```bash
cd apps/outreach && pnpm dev 2>&1 | head -30
```

Expected: server starts, no migration errors in output.

- [ ] **Step 5: Commit**

```bash
git add apps/outreach/server/db/schema.ts apps/outreach/server/plugins/db.ts
git commit -m "feat: add messaging_canvases table and canvas_id columns (migrations 31-35)"
```

---

## Task 2: System template seeder

**Files:**
- Create: `apps/outreach/server/helpers/seed-system-canvases.ts`

**Interfaces:**
- Produces: `seedSystemCanvases(db): Promise<void>` — idempotent, safe to call on every startup or request
- Produces: `SYSTEM_CANVAS_IDS: { account: string; role: string; prospect: string; blank: string }` — stable IDs for system canvases (hardcoded so they never drift)

- [ ] **Step 1: Create the seeder helper**

Create `apps/outreach/server/helpers/seed-system-canvases.ts`:

```typescript
import { eq } from "drizzle-orm";
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
  const { eq, isNull, and, or } = await import("drizzle-orm");

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
```

- [ ] **Step 2: Verify the file has no TypeScript errors**

```bash
cd apps/outreach && pnpm tsc --noEmit 2>&1 | grep seed-system-canvases
```

Expected: no output (no errors).

- [ ] **Step 3: Commit**

```bash
git add apps/outreach/server/helpers/seed-system-canvases.ts
git commit -m "feat: add system canvas seeder and user canvas bootstrapper"
```

---

## Task 3: Canvas CRUD actions

**Files:**
- Create: `apps/outreach/actions/list-canvases.ts`
- Create: `apps/outreach/actions/create-canvas.ts`
- Create: `apps/outreach/actions/rename-canvas.ts`
- Create: `apps/outreach/actions/delete-canvas.ts`
- Modify: `apps/outreach/server/plugins/auth.ts`

**Interfaces:**
- `list-canvases` GET → `{ canvases: Array<{ id, name, templateSlug, isSystem, createdAt }> }`
- `create-canvas` POST `{ templateSlug: string, name?: string }` → `{ id, name }`
- `rename-canvas` POST `{ id: string, name: string }` → `{ ok: boolean }`
- `delete-canvas` POST `{ id: string }` → `{ ok: boolean }`

- [ ] **Step 1: Create `list-canvases.ts`**

```typescript
// apps/outreach/actions/list-canvases.ts
import { defineAction } from "@agent-native/core";
import { asc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { seedSystemCanvases } from "../server/helpers/seed-system-canvases.js";

export default defineAction({
  description: "List all messaging canvases visible to the caller: system templates plus their own canvases.",
  schema: z.object({
    apiToken: z.string().nullish(),
  }),
  http: { method: "GET" },
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: async ({ apiToken }, ctx) => {
    const db = getDb();
    await seedSystemCanvases(db);

    const ownerEmail = await resolveOwner(apiToken, ctx);

    const rows = await db
      .select({
        id: messagingCanvases.id,
        name: messagingCanvases.name,
        templateSlug: messagingCanvases.templateSlug,
        isSystem: messagingCanvases.isSystem,
        createdAt: messagingCanvases.createdAt,
      })
      .from(messagingCanvases)
      .where(
        ownerEmail
          ? or(eq(messagingCanvases.isSystem, 1), eq(messagingCanvases.ownerEmail, ownerEmail))
          : eq(messagingCanvases.isSystem, 1),
      )
      .orderBy(asc(messagingCanvases.isSystem), asc(messagingCanvases.createdAt));

    return { canvases: rows };
  },
});
```

- [ ] **Step 2: Create `create-canvas.ts`**

```typescript
// apps/outreach/actions/create-canvas.ts
import { defineAction } from "@agent-native/core";
import { eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases, messagingNodes, messagingEdges } from "../server/db/schema.js";
import { SYSTEM_CANVAS_IDS } from "../server/helpers/seed-system-canvases.js";

const TEMPLATE_NAMES: Record<string, string> = {
  account:  "Account Messaging",
  role:     "Role Messaging",
  prospect: "Prospect Messaging",
  blank:    "Blank",
};

export default defineAction({
  description: "Create a new user canvas by copying a system template. Returns the new canvas id and name.",
  schema: z.object({
    templateSlug: z.enum(["account", "role", "prospect", "blank"]),
    name: z.string().min(1).max(80).optional(),
  }),
  requiresAuth: true,
  run: async ({ templateSlug, name: nameArg }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;
    const now = new Date().toISOString();

    // Auto-increment name if user already has a canvas with the default name
    let name = nameArg ?? TEMPLATE_NAMES[templateSlug] ?? "Canvas";
    const existing = await db
      .select({ name: messagingCanvases.name })
      .from(messagingCanvases)
      .where(eq(messagingCanvases.ownerEmail, ownerEmail));
    const existingNames = new Set(existing.map((r) => r.name));
    let suffix = 2;
    let candidate = name;
    while (existingNames.has(candidate)) {
      candidate = `${name} ${suffix++}`;
    }
    name = candidate;

    const canvasId = nanoid();
    await db.insert(messagingCanvases).values({
      id: canvasId,
      name,
      templateSlug,
      isSystem: 0,
      ownerEmail,
      createdAt: now,
      updatedAt: now,
    });

    // Copy template nodes into the new canvas (skip blank)
    if (templateSlug !== "blank") {
      const systemCanvasId = SYSTEM_CANVAS_IDS[templateSlug as keyof typeof SYSTEM_CANVAS_IDS];
      const templateNodes = await db
        .select()
        .from(messagingNodes)
        .where(eq(messagingNodes.canvasId, systemCanvasId));

      for (const n of templateNodes) {
        await db.insert(messagingNodes).values({
          ...n,
          id: nanoid(),
          ownerEmail,
          canvasId,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return { id: canvasId, name };
  },
});
```

- [ ] **Step 3: Create `rename-canvas.ts`**

```typescript
// apps/outreach/actions/rename-canvas.ts
import { defineAction } from "@agent-native/core";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases } from "../server/db/schema.js";

export default defineAction({
  description: "Rename a user-owned messaging canvas.",
  schema: z.object({
    id: z.string(),
    name: z.string().min(1).max(80),
  }),
  requiresAuth: true,
  run: async ({ id, name }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    const row = await db
      .select({ isSystem: messagingCanvases.isSystem, ownerEmail: messagingCanvases.ownerEmail })
      .from(messagingCanvases)
      .where(eq(messagingCanvases.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Canvas not found." };
    if (row[0].isSystem) return { ok: false, error: "System canvases cannot be renamed." };
    if (row[0].ownerEmail !== ownerEmail) return { ok: false, error: "Not authorized." };

    await db
      .update(messagingCanvases)
      .set({ name, updatedAt: new Date().toISOString() })
      .where(and(eq(messagingCanvases.id, id), eq(messagingCanvases.ownerEmail, ownerEmail)));

    return { ok: true };
  },
});
```

- [ ] **Step 4: Create `delete-canvas.ts`**

```typescript
// apps/outreach/actions/delete-canvas.ts
import { defineAction } from "@agent-native/core";
import { and, eq, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { messagingCanvases, messagingNodes, messagingEdges } from "../server/db/schema.js";

export default defineAction({
  description: "Delete a user-owned messaging canvas and all its nodes and edges.",
  schema: z.object({ id: z.string() }),
  requiresAuth: true,
  run: async ({ id }, ctx) => {
    const db = getDb();
    const ownerEmail = ctx!.userEmail!;

    const row = await db
      .select({ isSystem: messagingCanvases.isSystem, ownerEmail: messagingCanvases.ownerEmail })
      .from(messagingCanvases)
      .where(eq(messagingCanvases.id, id))
      .limit(1);

    if (!row[0]) return { ok: false, error: "Canvas not found." };
    if (row[0].isSystem) return { ok: false, error: "System canvases cannot be deleted." };
    if (row[0].ownerEmail !== ownerEmail) return { ok: false, error: "Not authorized." };

    // Collect node IDs to clean up edges
    const nodeIds = (
      await db
        .select({ id: messagingNodes.id })
        .from(messagingNodes)
        .where(eq(messagingNodes.canvasId, id))
    ).map((n) => n.id);

    // Delete edges, nodes, canvas
    if (nodeIds.length > 0) {
      for (const nodeId of nodeIds) {
        await db
          .delete(messagingEdges)
          .where(or(eq(messagingEdges.sourceId, nodeId), eq(messagingEdges.targetId, nodeId)));
      }
      await db.delete(messagingNodes).where(eq(messagingNodes.canvasId, id));
    }
    await db.delete(messagingCanvases).where(eq(messagingCanvases.id, id));

    return { ok: true };
  },
});
```

- [ ] **Step 5: Add `list-canvases` to publicPaths in `auth.ts`**

In `apps/outreach/server/plugins/auth.ts`, add `"/_agent-native/actions/list-canvases"` to the `publicPaths` array.

- [ ] **Step 6: Verify TypeScript**

```bash
cd apps/outreach && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add apps/outreach/actions/list-canvases.ts apps/outreach/actions/create-canvas.ts \
        apps/outreach/actions/rename-canvas.ts apps/outreach/actions/delete-canvas.ts \
        apps/outreach/server/plugins/auth.ts
git commit -m "feat: add canvas CRUD actions (list, create, rename, delete)"
```

---

## Task 4: Update existing graph/node actions for canvas_id

**Files:**
- Modify: `apps/outreach/actions/get-messaging-graph.ts`
- Modify: `apps/outreach/actions/create-messaging-node.ts`
- Modify: `apps/outreach/actions/create-messaging-edge.ts`
- Modify: `apps/outreach/actions/delete-messaging-node.ts`

**Interfaces:**
- `get-messaging-graph` now accepts optional `canvasId: string` — filters nodes/edges to that canvas
- `create-messaging-node` now accepts required `canvasId: string` and `"company"` as a valid `nodeType`
- `create-messaging-edge` now accepts `canvasId: string`
- `delete-messaging-node` now allows deleting `"company"` nodes

- [ ] **Step 1: Update `get-messaging-graph.ts`**

Change the schema to accept an optional `canvasId`:

```typescript
schema: z.object({
  canvasId: z.string().optional(),
}),
```

In `run`, replace the existing node/edge query with canvas-scoped versions:

```typescript
run: async ({ canvasId }, ctx) => {
  const db = getDb();
  const userEmail = ctx!.userEmail!;

  // Ensure the user has at least one canvas (lazy migration)
  const { ensureUserCanvas } = await import("../server/helpers/seed-system-canvases.js");
  const { seedSystemCanvases } = await import("../server/helpers/seed-system-canvases.js");
  await seedSystemCanvases(db);
  const defaultCanvasId = await ensureUserCanvas(userEmail, db);
  const activeCanvasId = canvasId ?? defaultCanvasId;

  const [allNodes, allEdges, personas] = await Promise.all([
    db.select().from(messagingNodes)
      .where(eq(messagingNodes.canvasId, activeCanvasId))
      .orderBy(asc(messagingNodes.createdAt)),
    db.select().from(messagingEdges)
      .where(eq(messagingEdges.canvasId, activeCanvasId))
      .orderBy(asc(messagingEdges.createdAt)),
    db.select({ id: icpPersonas.id, name: icpPersonas.name, color: icpPersonas.color, icpText: icpPersonas.icpText })
      .from(icpPersonas)
      .orderBy(asc(icpPersonas.createdAt)),
  ]);

  return { nodes: allNodes, edges: allEdges, personas, activeCanvasId };
},
```

Remove the persona-node auto-sync and auto-creation logic from `get-messaging-graph` — under the canvas system, persona nodes live in the Prospect Messaging template canvas and are copied at canvas-creation time, not auto-created per-user.

- [ ] **Step 2: Update `create-messaging-node.ts`**

Add `canvasId` to the schema and `"company"` to the node type enum:

```typescript
schema: z.object({
  canvasId: z.string(),
  nodeType: z.enum(["tone", "phrase_rule", "example", "role", "company"]).default("tone"),
  title: z.string().min(1).max(120).optional(),
  positionX: z.number().int().default(300),
  positionY: z.number().int().default(300),
  tone: z.string().nullable().optional(),
  valueProps: z.string().nullable().optional(),
  phrasesToUse: z.string().nullable().optional(),
  phrasesToAvoid: z.string().nullable().optional(),
  exampleNotes: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
}),
```

Add `canvasId` to the `DEFAULT_TITLES` map: `company: "Company"`.

Pass `canvasId` when inserting the node row.

- [ ] **Step 3: Update `create-messaging-edge.ts`**

Add `canvasId: z.string()` to the schema. Pass `canvasId` when inserting the edge row. Update the duplicate-edge and cycle-check queries to also filter by `canvasId`.

- [ ] **Step 4: Update `delete-messaging-node.ts`**

In the guard that prevents deletion, change:

```typescript
// Before:
if (row[0].type === "global" || row[0].type === "persona") {
  return { ok: false, error: "Cannot delete persona anchor nodes." };
}
// After:
if (row[0].type === "global") {
  return { ok: false, error: "Cannot delete the global node." };
}
if (row[0].isSystem === 1) {
  return { ok: false, error: "Cannot delete system template nodes." };
}
```

Note: the `messagingNodes` table does not have `is_system`. Instead, check whether the node belongs to a system canvas by joining `messagingCanvases`:

```typescript
const row = await db
  .select({
    type: messagingNodes.type,
    ownerEmail: messagingNodes.ownerEmail,
    canvasId: messagingNodes.canvasId,
  })
  .from(messagingNodes)
  .where(eq(messagingNodes.id, id))
  .limit(1);

if (!row[0]) return { ok: false, error: "Node not found" };
if (row[0].type === "global") return { ok: false, error: "Cannot delete the global node." };
if (row[0].ownerEmail !== ctx!.userEmail) return { ok: false, error: "Not authorized to delete this node." };
```

- [ ] **Step 5: Verify TypeScript**

```bash
cd apps/outreach && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add apps/outreach/actions/get-messaging-graph.ts \
        apps/outreach/actions/create-messaging-node.ts \
        apps/outreach/actions/create-messaging-edge.ts \
        apps/outreach/actions/delete-messaging-node.ts
git commit -m "feat: update graph/node/edge actions to scope by canvas_id"
```

---

## Task 5: Canvas-aware messaging context + capture-profile update

**Files:**
- Create: `apps/outreach/server/helpers/build-canvas-context.ts`
- Modify: `apps/outreach/actions/capture-profile.ts`

**Interfaces:**
- Produces: `buildCanvasContext(canvasId: string, db): Promise<string | null>` — returns formatted messaging guidelines string or null
- `capture-profile` now accepts optional `canvasId: string` in its schema

- [ ] **Step 1: Create `build-canvas-context.ts`**

```typescript
// apps/outreach/server/helpers/build-canvas-context.ts
import { eq } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { messagingNodes } from "../db/schema.js";

type Db = ReturnType<typeof getDb>;
type DbNode = typeof messagingNodes.$inferSelect;

function hasContent(n: DbNode): boolean {
  return !!(n.tone || n.valueProps || n.phrasesToUse || n.phrasesToAvoid || n.exampleNotes || n.notes);
}

export async function buildCanvasContext(
  canvasId: string,
  db: Db,
): Promise<string | null> {
  const nodes = await db
    .select()
    .from(messagingNodes)
    .where(eq(messagingNodes.canvasId, canvasId));

  if (nodes.length === 0 || !nodes.some(hasContent)) return null;

  const lines: string[] = ["MESSAGING GUIDELINES — apply when drafting the connection note:"];

  for (const n of nodes) {
    if (!hasContent(n)) continue;
    const t = n.type;

    if (t === "persona" || t === "role") {
      lines.push(`\n[${t === "persona" ? `Persona: ${n.title}` : `Role: ${n.title}`}]`);
      if (n.tone) lines.push(`Tone/Voice: ${n.tone}`);
      if (n.valueProps) lines.push(`Key value props: ${n.valueProps}`);
      if (n.phrasesToUse) lines.push(`Always use: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`Never say: ${n.phrasesToAvoid}`);
      if (n.notes) lines.push(n.notes);
    } else if (t === "tone") {
      lines.push(`\n[Tone & Voice${n.title !== "Tone & Voice" ? ` — ${n.title}` : ""}]`);
      if (n.tone) lines.push(n.tone);
      if (n.valueProps) lines.push(`Key value props: ${n.valueProps}`);
    } else if (t === "phrase_rule") {
      lines.push(`\n[Phrase Rule${n.title !== "Phrase Rule" ? ` — ${n.title}` : ""}]`);
      if (n.phrasesToUse) lines.push(`✓ Always use: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`✗ Never say: ${n.phrasesToAvoid}`);
    } else if (t === "example") {
      lines.push(`\n[Example Note${n.title !== "Example Note" ? ` — ${n.title}` : ""}]`);
      if (n.exampleNotes) lines.push(`Write notes like this:\n${n.exampleNotes}`);
    } else if (t === "company") {
      lines.push(`\n[Company Context: ${n.title}]`);
      if (n.notes) lines.push(n.notes);
    }
  }

  return lines.join("\n").trim();
}
```

- [ ] **Step 2: Update `capture-profile.ts` to accept and use `canvasId`**

Add `canvasId: z.string().nullish()` to the schema.

In `run`, after resolving `ownerEmail`, call `buildCanvasContext` when `canvasId` is provided:

```typescript
// Add this import at the top:
import { buildCanvasContext } from "../server/helpers/build-canvas-context.js";

// In run(), after ownerEmail is resolved:
const canvasMessagingContext = args.canvasId
  ? await buildCanvasContext(args.canvasId, db)
  : null;
```

Pass `canvasMessagingContext` into `draftProfile` (or wherever the messaging context is injected into the agent prompt). Look at how `buildMessagingContext` result is currently used in `capture-profile.ts` and replace/supplement it with `canvasMessagingContext`.

- [ ] **Step 3: Verify TypeScript**

```bash
cd apps/outreach && pnpm tsc --noEmit 2>&1 | head -20
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/outreach/server/helpers/build-canvas-context.ts \
        apps/outreach/actions/capture-profile.ts
git commit -m "feat: add canvas-scoped messaging context, pass canvasId through capture-profile"
```

---

## Task 6: CanvasTabBar and TemplatePicker components

**Files:**
- Create: `apps/outreach/app/components/canvas/CanvasTabBar.tsx`
- Create: `apps/outreach/app/components/canvas/TemplatePicker.tsx`

**Interfaces:**
- `CanvasTabBar` props: `{ canvases: Canvas[], activeId: string, onSelect(id: string): void, onAdd(): void, onRename(id: string, name: string): void, onDelete(id: string): void }`
- `TemplatePicker` props: `{ open: boolean, onSelect(slug: TemplateSlug): void, onClose(): void }`
- `Canvas` type: `{ id: string; name: string; isSystem: number; templateSlug: string | null }`
- `TemplateSlug` type: `"account" | "role" | "prospect" | "blank"`

- [ ] **Step 1: Create `CanvasTabBar.tsx`**

```tsx
// apps/outreach/app/components/canvas/CanvasTabBar.tsx
import { IconLock, IconPlus, IconX } from "@tabler/icons-react";
import { useRef, useState } from "react";

export interface Canvas {
  id: string;
  name: string;
  isSystem: number;
  templateSlug: string | null;
}

interface Props {
  canvases: Canvas[];
  activeId: string;
  onSelect: (id: string) => void;
  onAdd: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
}

export function CanvasTabBar({ canvases, activeId, onSelect, onAdd, onRename, onDelete }: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function startRename(canvas: Canvas) {
    if (canvas.isSystem) return;
    setEditingId(canvas.id);
    setEditValue(canvas.name);
    setTimeout(() => inputRef.current?.select(), 0);
  }

  function commitRename() {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  }

  return (
    <>
      <div className="flex items-center gap-0.5 border-b border-zinc-200 dark:border-zinc-800 px-2 overflow-x-auto">
        {canvases.map((canvas) => {
          const isActive = canvas.id === activeId;
          return (
            <div
              key={canvas.id}
              className={`group relative flex items-center gap-1.5 px-3 py-2 text-xs font-medium cursor-pointer rounded-t whitespace-nowrap select-none transition-colors
                ${isActive
                  ? "border-b-2 border-primary text-foreground bg-background"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted"
                }`}
              onClick={() => onSelect(canvas.id)}
              onDoubleClick={() => startRename(canvas)}
            >
              {canvas.isSystem === 1 && (
                <IconLock size={10} className="shrink-0 opacity-60" />
              )}
              {editingId === canvas.id ? (
                <input
                  ref={inputRef}
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-24 bg-transparent border-b border-primary outline-none text-xs"
                />
              ) : (
                <span>{canvas.name}</span>
              )}
              {canvas.isSystem === 0 && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setConfirmDeleteId(canvas.id);
                  }}
                  className="hidden group-hover:flex items-center justify-center w-3.5 h-3.5 rounded-full hover:bg-destructive/20 text-muted-foreground hover:text-destructive ml-0.5"
                >
                  <IconX size={9} />
                </button>
              )}
            </div>
          );
        })}
        <button
          type="button"
          onClick={onAdd}
          className="flex items-center justify-center px-2 py-2 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
        >
          <IconPlus size={14} />
        </button>
      </div>

      {/* Delete confirmation dialog */}
      {confirmDeleteId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-2xl bg-card border border-border shadow-2xl p-6">
            <h2 className="text-sm font-semibold mb-2">Delete this canvas?</h2>
            <p className="text-xs text-muted-foreground mb-5">
              This will permanently delete the canvas and all its nodes. This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setConfirmDeleteId(null)}
                className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onDelete(confirmDeleteId);
                  setConfirmDeleteId(null);
                }}
                className="rounded-lg bg-destructive px-4 py-2 text-xs font-medium text-destructive-foreground hover:bg-destructive/90"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
```

- [ ] **Step 2: Create `TemplatePicker.tsx`**

```tsx
// apps/outreach/app/components/canvas/TemplatePicker.tsx
import { IconBriefcase, IconBuilding, IconUser, IconX } from "@tabler/icons-react";

export type TemplateSlug = "account" | "role" | "prospect" | "blank";

interface Template {
  slug: TemplateSlug;
  name: string;
  description: string;
  Icon: React.ComponentType<{ size?: number; className?: string }>;
}

const TEMPLATES: Template[] = [
  {
    slug: "account",
    name: "Account Messaging",
    description: "Build messaging around a specific company or account plan",
    Icon: IconBuilding,
  },
  {
    slug: "role",
    name: "Role Messaging",
    description: "Target a specific job function or seniority level",
    Icon: IconBriefcase,
  },
  {
    slug: "prospect",
    name: "Prospect Messaging",
    description: "Personalized one-to-one outreach for an individual",
    Icon: IconUser,
  },
  {
    slug: "blank",
    name: "Blank",
    description: "Empty canvas — start from scratch",
    Icon: IconX,
  },
];

interface Props {
  open: boolean;
  onSelect: (slug: TemplateSlug) => void;
  onClose?: () => void;
}

export function TemplatePicker({ open, onSelect, onClose }: Props) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-lg rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold">Choose a starting template</h2>
          {onClose && (
            <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
              <IconX size={16} />
            </button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 p-5">
          {TEMPLATES.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => onSelect(t.slug)}
              className="flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left hover:border-primary hover:bg-primary/5 transition-colors"
            >
              <div className="flex items-center justify-center w-8 h-8 rounded-lg bg-muted">
                <t.Icon size={16} className="text-foreground" />
              </div>
              <div>
                <p className="text-xs font-semibold">{t.name}</p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript on new components**

```bash
cd apps/outreach && pnpm tsc --noEmit 2>&1 | grep -E "CanvasTabBar|TemplatePicker" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add apps/outreach/app/components/canvas/
git commit -m "feat: add CanvasTabBar and TemplatePicker components"
```

---

## Task 7: Wire canvas tab system into messaging.tsx

**Files:**
- Modify: `apps/outreach/app/routes/messaging.tsx`

**Interfaces:**
- Consumes: `CanvasTabBar`, `TemplatePicker` from Task 6
- Consumes: `list-canvases`, `create-canvas`, `rename-canvas`, `delete-canvas` actions from Task 3
- `get-messaging-graph` now receives `{ canvasId }` param

- [ ] **Step 1: Add canvas state and queries to `MessagingCanvas`**

At the top of `MessagingCanvas`, add:

```typescript
const { data: canvasData, refetch: refetchCanvases } = useActionQuery<{
  canvases: Array<{ id: string; name: string; isSystem: number; templateSlug: string | null }>;
}>("list-canvases", {});

const createCanvas = useActionMutation("create-canvas");
const renameCanvas = useActionMutation("rename-canvas");
const deleteCanvas = useActionMutation("delete-canvas");

const [activeCanvasId, setActiveCanvasId] = useState<string | null>(null);
const [pickerOpen, setPickerOpen] = useState(false);
```

- [ ] **Step 2: Derive active canvas and show template picker on first visit**

```typescript
const userCanvases = (canvasData?.canvases ?? []).filter((c) => c.isSystem === 0);
const systemCanvases = (canvasData?.canvases ?? []).filter((c) => c.isSystem === 1);
const allTabCanvases = [...systemCanvases, ...userCanvases];

// Show template picker when user has no canvases
useEffect(() => {
  if (canvasData && userCanvases.length === 0) {
    setPickerOpen(true);
  }
}, [canvasData]);

// Set active canvas when canvases load
useEffect(() => {
  if (!activeCanvasId && userCanvases.length > 0) {
    setActiveCanvasId(userCanvases[0].id);
  }
}, [canvasData]);
```

- [ ] **Step 3: Update the `get-messaging-graph` query to pass `activeCanvasId`**

```typescript
const { data: graph, isLoading, refetch } = useActionQuery<GraphData>(
  "get-messaging-graph",
  activeCanvasId ? { canvasId: activeCanvasId } : {},
  { enabled: !!activeCanvasId },
);
```

- [ ] **Step 4: Add handlers for canvas CRUD**

```typescript
async function handleSelectTemplate(slug: TemplateSlug) {
  setPickerOpen(false);
  const result = await createCanvas.mutateAsync({ templateSlug: slug }) as { id: string; name: string };
  await refetchCanvases();
  setActiveCanvasId(result.id);
}

async function handleRenameCanvas(id: string, name: string) {
  await renameCanvas.mutateAsync({ id, name });
  refetchCanvases();
}

async function handleDeleteCanvas(id: string) {
  await deleteCanvas.mutateAsync({ id });
  await refetchCanvases();
  // Switch to first remaining user canvas
  const remaining = userCanvases.filter((c) => c.id !== id);
  if (remaining.length > 0) {
    setActiveCanvasId(remaining[0].id);
  } else {
    setActiveCanvasId(null);
    setPickerOpen(true);
  }
}
```

- [ ] **Step 5: Render `CanvasTabBar` and `TemplatePicker` in the JSX**

In the return JSX of `MessagingCanvas`, insert the `CanvasTabBar` between the toolbar and the canvas:

```tsx
<CanvasTabBar
  canvases={allTabCanvases}
  activeId={activeCanvasId ?? ""}
  onSelect={setActiveCanvasId}
  onAdd={() => setPickerOpen(true)}
  onRename={handleRenameCanvas}
  onDelete={handleDeleteCanvas}
/>
<TemplatePicker
  open={pickerOpen}
  onSelect={handleSelectTemplate}
  onClose={userCanvases.length > 0 ? () => setPickerOpen(false) : undefined}
/>
```

- [ ] **Step 6: Pass `canvasId` into `create-messaging-node` and `create-messaging-edge` calls**

Find every call to `createNode.mutateAsync` and `createEdge.mutateAsync` in `MessagingCanvas` and add `canvasId: activeCanvasId` to the argument object.

- [ ] **Step 7: Verify in the dev server — tab bar appears, template picker fires on first visit**

```bash
cd apps/outreach && pnpm dev
```

Open the messaging page. Verify: tab bar renders, template picker appears on first visit, creating a canvas switches to it.

- [ ] **Step 8: Commit**

```bash
git add apps/outreach/app/routes/messaging.tsx
git commit -m "feat: wire canvas tab system into messaging page"
```

---

## Task 8: Company node

**Files:**
- Modify: `apps/outreach/app/routes/messaging.tsx`

**Interfaces:**
- Adds `"company"` to `NodeKind` union and `NODE_CONFIG`
- `CompanyNode` function component defined inside messaging.tsx alongside `CanvasNode`
- Auto-research triggers `sendToAgentChat` on title blur

- [ ] **Step 1: Extend `NodeKind` and `NODE_CONFIG` for company**

In `messaging.tsx`, add `"company"` to the `NodeKind` type:

```typescript
type NodeKind = "persona" | "tone" | "phrase_rule" | "example" | "role" | "company";
```

Add to `NODE_CONFIG`:

```typescript
company: {
  label: "Company",
  color: "#0e7490",
  Icon: IconBuilding,
  description: "Company context — auto-researches from the internet",
  previewFields: ["notes"],
},
```

Add `IconBuilding` to the `@tabler/icons-react` import.

- [ ] **Step 2: Add `CompanyNode` component**

Add this function inside `messaging.tsx` near `CanvasNode`:

```tsx
function CompanyNode({ data }: NodeProps) {
  const d = data as NodeData & { onResearch: (id: string, company: string) => void };
  const [company, setCompany] = useState(d.dbNode.title === "Company" ? "" : d.dbNode.title);
  const [researching, setResearching] = useState(false);
  const prevCompanyRef = useRef(company);

  function handleBlur() {
    const trimmed = company.trim();
    if (!trimmed || trimmed === prevCompanyRef.current) return;
    prevCompanyRef.current = trimmed;
    setResearching(true);
    d.onResearch(d.dbNode.id, trimmed);
  }

  return (
    <div
      className="rounded-xl border-2 border-cyan-600 bg-white dark:bg-zinc-900 shadow-md w-[220px] overflow-hidden"
      onClick={() => d.onClick(d.dbNode)}
    >
      <Handle type="target" position={Position.Left} />
      <div className="flex items-center gap-1.5 px-3 py-2 text-white bg-cyan-700">
        <IconBuilding size={12} className="shrink-0 opacity-90" />
        <p className="text-[11px] font-semibold flex-1 truncate">Company</p>
      </div>
      <div className="px-3 py-2 flex flex-col gap-1.5">
        <input
          value={company}
          onChange={(e) => setCompany(e.target.value)}
          onBlur={handleBlur}
          onClick={(e) => e.stopPropagation()}
          placeholder="Company name…"
          className="w-full bg-transparent border-b border-zinc-200 dark:border-zinc-700 text-xs outline-none pb-0.5"
        />
        {researching && (
          <p className="text-[10px] text-cyan-600 italic animate-pulse">Researching…</p>
        )}
        {d.dbNode.notes && !researching && (
          <p className="text-[10px] text-zinc-500 line-clamp-3">{d.dbNode.notes}</p>
        )}
        {!d.dbNode.notes && !researching && company && (
          <p className="text-[10px] text-zinc-400 italic">No research yet</p>
        )}
      </div>
      <Handle type="source" position={Position.Right} />
    </div>
  );
}
```

- [ ] **Step 3: Wire `onResearch` into the canvas**

In `MessagingCanvas`, add the research handler:

```typescript
const updateNode = useActionMutation("update-messaging-node");

function handleCompanyResearch(nodeId: string, companyName: string) {
  // Save the company name immediately
  updateNode.mutate({ id: nodeId, title: companyName });
  // Trigger agent research
  sendToAgentChat({
    message:
      `Research the company "${companyName}" and write a concise summary for use in LinkedIn outreach. ` +
      `Cover: industry, company size, recent news or announcements, key business initiatives, GTM motion, ` +
      `and inferred buyer pain points that would make them receptive to outreach.\n\n` +
      `When done, call update-messaging-node with id="${nodeId}" and set notes to your summary. ` +
      `Keep it under 200 words, factual, no fluff.`,
    submit: true,
  });
}
```

Pass `onResearch: handleCompanyResearch` in the `NodeData` for company nodes when calling `toFlowNode`.

Register `CompanyNode` in the `nodeTypes` object:

```typescript
const nodeTypes = useMemo(() => ({
  persona: CanvasNode,
  tone: CanvasNode,
  phrase_rule: CanvasNode,
  example: CanvasNode,
  role: CanvasNode,
  company: CompanyNode,
}), []);
```

After `isGenerating` transitions from `true` → `false`, call `refetch()` to update company node notes when the agent finishes writing them (this already happens via the existing `pendingBuildRef` pattern — just ensure `pendingBuildRef.current = true` is set when `handleCompanyResearch` fires).

- [ ] **Step 4: Add `"company"` to the add-node palette**

In `NodePalette` (within messaging.tsx), add `"company"` to the palette options so users can drag it onto the canvas.

- [ ] **Step 5: Verify company node renders and research triggers**

Start dev server. Add a Company node to the canvas. Type a company name and click away. Confirm "Researching…" appears and agent chat is triggered.

- [ ] **Step 6: Commit**

```bash
git add apps/outreach/app/routes/messaging.tsx
git commit -m "feat: add Company node with auto-research on blur"
```

---

## Task 9: Message preview panel

**Files:**
- Create: `apps/outreach/app/components/canvas/PreviewPanel.tsx`
- Modify: `apps/outreach/app/routes/messaging.tsx`

**Interfaces:**
- `PreviewPanel` props: `{ open: boolean, onClose(): void, onGenerate(): void, preview: string | null, generating: boolean }`

- [ ] **Step 1: Create `PreviewPanel.tsx`**

```tsx
// apps/outreach/app/components/canvas/PreviewPanel.tsx
import { IconRefresh, IconX, IconClipboard, IconCheck, IconSparkles } from "@tabler/icons-react";
import { useState } from "react";

interface Props {
  open: boolean;
  onClose: () => void;
  onGenerate: () => void;
  preview: string | null;
  generating: boolean;
}

export function PreviewPanel({ open, onClose, onGenerate, preview, generating }: Props) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  function handleCopy() {
    if (!preview) return;
    navigator.clipboard.writeText(preview).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="absolute right-0 top-0 bottom-0 w-80 z-30 flex flex-col bg-background border-l border-border shadow-xl">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <IconSparkles size={14} className="text-primary" />
          <span className="text-sm font-semibold">Message Preview</span>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 hover:bg-muted text-muted-foreground">
          <IconX size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {generating && (
          <p className="text-xs text-muted-foreground italic animate-pulse">Generating preview…</p>
        )}
        {!generating && !preview && (
          <p className="text-xs text-muted-foreground italic">
            Click "Generate" to preview what a connection note would look like using this canvas.
          </p>
        )}
        {!generating && preview && (
          <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{preview}</p>
        )}
      </div>

      <div className="flex gap-2 px-4 py-3 border-t border-border">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="flex-1 inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
        >
          <IconRefresh size={12} className={generating ? "animate-spin" : ""} />
          {preview ? "Regenerate" : "Generate"}
        </button>
        {preview && (
          <button
            type="button"
            onClick={handleCopy}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-muted"
          >
            {copied ? <IconCheck size={12} /> : <IconClipboard size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire `PreviewPanel` into `MessagingCanvas`**

Add state and handler:

```typescript
const [previewOpen, setPreviewOpen] = useState(false);
const [previewText, setPreviewText] = useState<string | null>(null);
const [previewing, setPreviewing] = useState(false);
const previewPendingRef = useRef(false);

function handleGeneratePreview() {
  if (!graph || !activeCanvasId) return;
  setPreviewing(true);
  previewPendingRef.current = true;

  const nodesSummary = graph.nodes
    .filter((n) => n.tone || n.valueProps || n.phrasesToUse || n.phrasesToAvoid || n.exampleNotes || n.notes)
    .map((n) => `[${n.type.toUpperCase()}: ${n.title}]\n${[n.tone, n.valueProps, n.phrasesToUse, n.phrasesToAvoid, n.exampleNotes, n.notes].filter(Boolean).join(" | ")}`)
    .join("\n\n");

  sendToAgentChat({
    message:
      `Generate a sample LinkedIn connection note using the messaging canvas below. ` +
      `Draft it as if messaging a fictional prospect: Alex Chen, VP of Sales at a mid-size B2B SaaS company. ` +
      `Do NOT call any actions. Just write the connection note — 200–300 characters — and reply with ONLY the note, no preamble.\n\n` +
      `## Canvas guidelines\n${nodesSummary || "(empty canvas — use a neutral professional tone)"}`,
    submit: true,
  });
}
```

In the `useEffect` that watches `isGenerating`, when the generating state resolves and `previewPendingRef.current` is true, capture the last agent message as the preview text. The simplest approach: use a ref to listen for the last agent text message. Alternatively, show a note to the user to look at the agent chat for the preview and use a simpler implementation where the panel just triggers the chat and the user reads it there.

**Simpler implementation (recommended):** The "Preview" button triggers `sendToAgentChat` as above, opens the native agent chat panel, and the `PreviewPanel` just acts as a launcher with a spinner while `isGenerating` is true:

```typescript
// In the isGenerating effect:
useEffect(() => {
  if (wasGeneratingRef.current && !isGenerating) {
    if (previewPendingRef.current) {
      previewPendingRef.current = false;
      setPreviewing(false);
      // The result is in the agent chat panel — no need to extract it
    }
    if (pendingBuildRef.current) {
      pendingBuildRef.current = false;
      refetch();
    }
  }
  wasGeneratingRef.current = isGenerating;
}, [isGenerating, refetch]);
```

For the preview text: pass `preview={null}` and `generating={previewing}` to `PreviewPanel`. Show a message directing the user to the agent chat panel to see the result, or leave the panel text as "Preview generated — see the AI chat panel."

- [ ] **Step 3: Add "Preview message" button to the toolbar**

In the toolbar JSX, add before the "Build with AI" button:

```tsx
<Button
  size="sm"
  variant="outline"
  onClick={() => { setPreviewOpen(true); handleGeneratePreview(); }}
  className="gap-1.5"
>
  <IconSparkles size={14} />
  Preview message
</Button>
```

- [ ] **Step 4: Render `PreviewPanel` in the canvas wrapper div**

Wrap the `<div className="flex-1">` (the ReactFlow container) and `PreviewPanel` in a relative-positioned container:

```tsx
<div className="flex-1 relative">
  <ReactFlow .../>
  <PreviewPanel
    open={previewOpen}
    onClose={() => setPreviewOpen(false)}
    onGenerate={handleGeneratePreview}
    preview={null}
    generating={previewing}
  />
</div>
```

- [ ] **Step 5: Commit**

```bash
git add apps/outreach/app/components/canvas/PreviewPanel.tsx apps/outreach/app/routes/messaging.tsx
git commit -m "feat: add message preview panel"
```

---

## Task 10: Right-click AI node menu

**Files:**
- Create: `apps/outreach/app/components/canvas/NodeContextMenu.tsx`
- Modify: `apps/outreach/app/routes/messaging.tsx`

**Interfaces:**
- `NodeContextMenu` props: `{ x: number, y: number, node: MessagingNode, onClose(): void, onDelete(): void, onAIAction(action: "variations" | "generate" | "rewrite", node: MessagingNode): void }`

- [ ] **Step 1: Create `NodeContextMenu.tsx`**

```tsx
// apps/outreach/app/components/canvas/NodeContextMenu.tsx
import { IconCopy, IconSparkles, IconTrash, IconEdit, IconRefresh } from "@tabler/icons-react";
import { useEffect, useRef } from "react";

type AIAction = "variations" | "generate" | "rewrite";

interface MessagingNodeLike {
  id: string;
  type: string;
  title: string;
}

interface Props {
  x: number;
  y: number;
  node: MessagingNodeLike;
  onClose: () => void;
  onDelete: () => void;
  onAIAction: (action: AIAction, nodeId: string) => void;
}

export function NodeContextMenu({ x, y, node, onClose, onDelete, onAIAction }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [onClose]);

  const isProtected = node.type === "persona" || node.type === "global";

  return (
    <div
      ref={ref}
      style={{ position: "fixed", top: y, left: x, zIndex: 1000 }}
      className="w-52 rounded-xl border border-border bg-popover shadow-xl py-1 text-sm"
    >
      <MenuItem icon={<IconCopy size={13} />} label="Create variations" onClick={() => { onAIAction("variations", node.id); onClose(); }} />
      <MenuItem icon={<IconSparkles size={13} />} label="Generate content" onClick={() => { onAIAction("generate", node.id); onClose(); }} />
      <MenuItem icon={<IconRefresh size={13} />} label="Rewrite" onClick={() => { onAIAction("rewrite", node.id); onClose(); }} />
      {!isProtected && (
        <>
          <div className="my-1 border-t border-border" />
          <MenuItem
            icon={<IconTrash size={13} />}
            label="Delete node"
            onClick={() => { onDelete(); onClose(); }}
            danger
          />
        </>
      )}
    </div>
  );
}

function MenuItem({
  icon, label, onClick, danger,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full flex items-center gap-2.5 px-3 py-1.5 text-xs hover:bg-muted transition-colors
        ${danger ? "text-destructive hover:bg-destructive/10" : "text-foreground"}`}
    >
      {icon}
      {label}
    </button>
  );
}
```

- [ ] **Step 2: Add context menu state and handlers to `MessagingCanvas`**

```typescript
const [contextMenu, setContextMenu] = useState<{
  x: number; y: number; node: MessagingNode;
} | null>(null);
```

Add an `onContextMenu` handler to `NodeData` and pass it through `toFlowNode`:

```typescript
// In NodeData interface, add:
onContextMenu: (node: MessagingNode, event: React.MouseEvent) => void;

// In CanvasNode component, add to the wrapper div:
onContextMenu={(e) => { e.preventDefault(); d.onContextMenu(d.dbNode, e); }}

// In MessagingCanvas:
const handleNodeContextMenu = useCallback((node: MessagingNode, e: React.MouseEvent) => {
  e.preventDefault();
  setContextMenu({ x: e.clientX, y: e.clientY, node });
}, []);
```

Pass `onContextMenu: handleNodeContextMenu` into `NodeData` when calling `toFlowNode`.

- [ ] **Step 3: Add AI action handler**

```typescript
function handleAIAction(action: "variations" | "generate" | "rewrite", nodeId: string) {
  const node = graph?.nodes.find((n) => n.id === nodeId);
  if (!node || !activeCanvasId) return;

  const nodeContent = [node.tone, node.valueProps, node.phrasesToUse, node.phrasesToAvoid, node.exampleNotes, node.notes]
    .filter(Boolean).join("\n");

  const prompts: Record<typeof action, string> = {
    variations:
      `Create 2 alternative versions of this messaging node and add them to the canvas.\n\n` +
      `Original node id: ${node.id}\nType: ${node.type}\nTitle: ${node.title}\nContent:\n${nodeContent || "(empty)"}\n\n` +
      `For each variation, call create-messaging-node with canvasId="${activeCanvasId}", the same nodeType="${node.type}", ` +
      `a slightly different title (e.g. "${node.title} — Variant A"), and different content. ` +
      `Place them at positionX=${node.positionX + 260}, positionY=${node.positionY} and positionY=${node.positionY + 240}.`,
    generate:
      `Fill this empty messaging node with content based on the rest of the canvas.\n\n` +
      `Node id: ${node.id}\nType: ${node.type}\nTitle: ${node.title}\n\n` +
      `Call update-messaging-node with id="${node.id}" and fill in appropriate content fields for this node type.`,
    rewrite:
      `Rewrite this messaging node's content from a different angle while keeping the same node type and structure.\n\n` +
      `Node id: ${node.id}\nType: ${node.type}\nTitle: ${node.title}\nCurrent content:\n${nodeContent || "(empty)"}\n\n` +
      `Call update-messaging-node with id="${node.id}" and replace the content fields with a rewritten version.`,
  };

  pendingBuildRef.current = true;
  sendToAgentChat({ message: prompts[action], submit: true });
}
```

- [ ] **Step 4: Render `NodeContextMenu` in `MessagingCanvas` JSX**

```tsx
{contextMenu && (
  <NodeContextMenu
    x={contextMenu.x}
    y={contextMenu.y}
    node={contextMenu.node}
    onClose={() => setContextMenu(null)}
    onDelete={() => {
      deleteNode.mutate({ id: contextMenu.node.id });
      handleNodeDeleted(contextMenu.node.id);
    }}
    onAIAction={handleAIAction}
  />
)}
```

- [ ] **Step 5: Commit**

```bash
git add apps/outreach/app/components/canvas/NodeContextMenu.tsx apps/outreach/app/routes/messaging.tsx
git commit -m "feat: add right-click AI node context menu (variations, generate, rewrite, delete)"
```

---

## Task 11: Hover delete button on canvas nodes

**Files:**
- Modify: `apps/outreach/app/routes/messaging.tsx`

**Note:** Keyboard delete (`Backspace`/`Delete`) is **already wired** via `deleteKeyCode={["Delete", "Backspace"]}` in the existing `ReactFlow` component and `handleBeforeDelete` guard. This task only adds the hover X button.

- [ ] **Step 1: Add hover X button to `CanvasNode`**

In the `CanvasNode` component, modify the wrapper div to use relative positioning and add the X button:

```tsx
<div
  className="relative rounded-xl border border-zinc-200/60 bg-white shadow-md dark:border-zinc-700/60 dark:bg-zinc-900 cursor-pointer w-[220px] overflow-hidden group"
  style={accentColor ? { borderLeft: `3px solid ${accentColor}` } : undefined}
  onClick={() => d.onClick(d.dbNode)}
  onContextMenu={(e) => { e.preventDefault(); d.onContextMenu(d.dbNode, e); }}
>
  {/* Hover delete — only for non-persona, non-global nodes */}
  {!isPersona && !isGlobal && (
    <button
      type="button"
      className="absolute top-1 right-1 z-10 hidden group-hover:flex items-center justify-center w-4 h-4 rounded-full bg-black/20 hover:bg-destructive text-white transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        d.onDelete(d.dbNode.id);
      }}
    >
      <IconX size={9} />
    </button>
  )}
  {/* Header */}
  ...rest of existing JSX unchanged
```

- [ ] **Step 2: Add `onDelete` to `NodeData` interface and wire it up**

```typescript
// In NodeData interface, add:
onDelete: (id: string) => void;

// In MessagingCanvas, create handler:
const handleHoverDelete = useCallback((id: string) => {
  deleteNode.mutate({ id });
  handleNodeDeleted(id);
}, [deleteNode]);
```

Pass `onDelete: handleHoverDelete` in the `NodeData` when calling `toFlowNode`.

- [ ] **Step 3: Verify hover X appears on non-persona nodes**

In the dev server, hover over a tone or phrase_rule node. Confirm X button appears. Click it. Node should disappear. Hover over a persona node — confirm no X.

- [ ] **Step 4: Commit**

```bash
git add apps/outreach/app/routes/messaging.tsx
git commit -m "feat: add hover delete button to canvas nodes"
```

---

## Task 12: Extension canvas picker

**Files:**
- Modify: `apps/outreach/extension/background.js`
- Modify: `apps/outreach/extension/panel.html`
- Modify: `apps/outreach/extension/panel.js`

**Interfaces:**
- `background.js` handles `LIST_CANVASES` message → fetches `list-canvases` action → returns `{ canvases }`
- `panel.js` loads canvases on init, renders dropdown, persists selection in `chrome.storage.local` as `lastCanvasId`, sends `canvasId` in `DRAFT_REQUEST`

- [ ] **Step 1: Add `listCanvases` function to `background.js`**

Add after the `getDailyStats` function:

```javascript
async function listCanvases(apiToken) {
  const { appUrl } = await getSettings();
  if (!appUrl) return { canvases: [] };
  try {
    const tokenParam = apiToken ? `?apiToken=${encodeURIComponent(apiToken)}` : "";
    const res = await fetch(`${appUrl}/_agent-native/actions/list-canvases${tokenParam}`);
    if (!res.ok) return { canvases: [] };
    const json = await res.json();
    // Extension only shows user-owned canvases (isSystem === 0)
    return { canvases: (json.canvases ?? []).filter((c) => c.isSystem === 0) };
  } catch {
    return { canvases: [] };
  }
}
```

Add to the `chrome.runtime.onMessage.addListener` switch:

```javascript
if (msg.type === "LIST_CANVASES") {
  listCanvases(msg.apiToken)
    .then((result) => sendResponse(result))
    .catch(() => sendResponse({ canvases: [] }));
  return true;
}
```

- [ ] **Step 2: Add canvas dropdown to `panel.html`**

Inside the main content area, above the `#draft-btn` button, add:

```html
<div id="canvas-picker-section" style="display:none">
  <label style="font-size:11px;color:var(--muted);display:block;margin-bottom:4px">Canvas</label>
  <select id="canvas-select" style="width:100%;font-size:12px;padding:4px 6px;border:1px solid var(--border);border-radius:6px;background:var(--bg);color:var(--fg)">
    <option value="">Loading canvases…</option>
  </select>
</div>
```

- [ ] **Step 3: Update `panel.js` to load canvases and persist selection**

Near the top, add element refs:

```javascript
const canvasPickerSection = document.getElementById("canvas-picker-section");
const canvasSelect = document.getElementById("canvas-select");
```

Add a `loadCanvases` function called during panel init (inside the tab update listener, after the API token is loaded):

```javascript
async function loadCanvases() {
  const { apiToken: token } = await chrome.storage.local.get(["apiToken"]);
  const { lastCanvasId } = await chrome.storage.local.get(["lastCanvasId"]);
  const result = await chrome.runtime.sendMessage({ type: "LIST_CANVASES", apiToken: token });
  const canvases = result?.canvases ?? [];

  if (canvases.length === 0) {
    canvasPickerSection.style.display = "none";
    return;
  }

  canvasSelect.innerHTML = canvases
    .map((c) => `<option value="${c.id}" ${c.id === lastCanvasId ? "selected" : ""}>${c.name}</option>`)
    .join("");

  canvasPickerSection.style.display = "block";
}

canvasSelect.addEventListener("change", () => {
  chrome.storage.local.set({ lastCanvasId: canvasSelect.value });
});
```

Call `loadCanvases()` in the main tab init flow.

- [ ] **Step 4: Pass `canvasId` in `DRAFT_REQUEST`**

In the `draftBtn` click handler, when building the profile data to send, add:

```javascript
const selectedCanvasId = canvasSelect.value || null;
if (selectedCanvasId) {
  chrome.storage.local.set({ lastCanvasId: selectedCanvasId });
}

const result = await chrome.runtime.sendMessage({
  type: "DRAFT_REQUEST",
  data: { ...profileData, canvasId: selectedCanvasId },
});
```

In `background.js`, the `captureThenPoll` function already passes `...profileData` to the `capture-profile` POST body — `canvasId` will flow through automatically since it's now in the data object.

- [ ] **Step 5: Package and test the extension**

```bash
cd apps/outreach && pnpm package-extension
```

Load the unpacked extension in Chrome (or use the zip). Open a LinkedIn profile. Verify the canvas dropdown appears in the panel, shows the user's canvases, persists the selection, and sends the correct `canvasId` when drafting.

- [ ] **Step 6: Commit**

```bash
git add apps/outreach/extension/background.js \
        apps/outreach/extension/panel.html \
        apps/outreach/extension/panel.js
git commit -m "feat: add canvas picker to extension panel, send canvas_id with draft requests"
```

---

## Self-Review Notes

**Spec coverage check:**
- ✅ Canvas tab system — Tasks 1, 2, 3, 7
- ✅ 4 starter templates with template picker — Tasks 2, 6, 7
- ✅ Template picker fires on first visit + `+` button — Task 7
- ✅ Tab hover X delete with confirmation — Task 6 (CanvasTabBar)
- ✅ Tab rename on double-click — Task 6 (CanvasTabBar)
- ✅ Extension canvas picker dropdown — Task 12
- ✅ `canvas_id` sent with draft — Tasks 5, 12
- ✅ Company node auto-research on blur — Task 8
- ✅ Message preview panel — Task 9
- ✅ Right-click AI node menu (variations, generate, rewrite) — Task 10
- ✅ Hover delete X button — Task 11
- ✅ Keyboard delete already wired — noted in Task 11 (no work needed)

**Type consistency:** `activeCanvasId` used consistently across Tasks 4, 7, 8, 9, 10. `MessagingNode` type unchanged — existing fields cover all new node types. `NodeData` extended with `onContextMenu` and `onDelete` in Tasks 10 and 11.

**Known simplification:** The preview panel (Task 9) directs results to the agent chat rather than extracting the text into the panel. This avoids needing a separate preview action and is consistent with how "Build with AI" works.
