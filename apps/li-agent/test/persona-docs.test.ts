import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { icpPersonaDocs, icpPersonas } from "../server/db/schema.js";
import {
  adoptLegacyIcpTextAsDoc,
  nextSortOrder,
  rebuildPersonaIcpText,
} from "../server/helpers/persona-docs.js";

// Exercises the multi-document ICP helper against a real in-memory SQLite DB
// rather than the app's own DB -- the local dev database can't migrate past
// v8 (a pre-existing `ON CONFLICT DO NOTHING` syntax failure), so nothing that
// goes through getDb() is runnable locally.
async function makeDb() {
  const client = createClient({ url: ":memory:" });
  await client.execute(`
    CREATE TABLE icp_personas (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      icp_text TEXT,
      summary TEXT,
      is_active INTEGER NOT NULL DEFAULT 0,
      created_at TEXT,
      updated_at TEXT
    )
  `);
  await client.execute(`
    CREATE TABLE icp_persona_docs (
      id TEXT PRIMARY KEY,
      persona_id TEXT NOT NULL,
      name TEXT NOT NULL,
      text TEXT NOT NULL,
      word_count INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT
    )
  `);
  return drizzle(client) as any;
}

async function seedPersona(db: any, over: Record<string, unknown> = {}) {
  await db.insert(icpPersonas).values({
    id: "p1",
    name: "VP Engineering",
    color: "#6366f1",
    icpText: null,
    summary: null,
    isActive: 0,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-01T00:00:00.000Z",
    ...over,
  });
}

async function addDoc(db: any, id: string, name: string, text: string, sortOrder: number) {
  await db.insert(icpPersonaDocs).values({
    id,
    personaId: "p1",
    name,
    text,
    wordCount: text.split(/\s+/).filter(Boolean).length,
    sortOrder,
    createdAt: "2026-08-01T00:00:00.000Z",
  });
}

async function readPersona(db: any) {
  const rows = await db
    .select({ icpText: icpPersonas.icpText, summary: icpPersonas.summary })
    .from(icpPersonas)
    .where(eq(icpPersonas.id, "p1"))
    .limit(1);
  return rows[0];
}

describe("rebuildPersonaIcpText", () => {
  let db: any;
  beforeEach(async () => { db = await makeDb(); });

  it("concatenates every document, in sortOrder, with a filename heading", async () => {
    await seedPersona(db);
    await addDoc(db, "d1", "core-icp.md", "Target VPs of Engineering.", 0);
    await addDoc(db, "d2", "disqualifiers.md", "Skip agencies and consultancies.", 1);

    const result = await rebuildPersonaIcpText(db, "p1");
    const persona = await readPersona(db);

    expect(result.docCount).toBe(2);
    expect(persona.icpText).toBe(
      "## core-icp.md\n\nTarget VPs of Engineering.\n\n---\n\n## disqualifiers.md\n\nSkip agencies and consultancies.",
    );
    // Both documents are actually visible to the scoring prompt.
    expect(persona.icpText).toContain("Target VPs of Engineering.");
    expect(persona.icpText).toContain("Skip agencies and consultancies.");
  });

  it("sums word counts across documents", async () => {
    await seedPersona(db);
    await addDoc(db, "d1", "a.md", "one two three", 0);
    await addDoc(db, "d2", "b.md", "four five", 1);

    const result = await rebuildPersonaIcpText(db, "p1");
    expect(result.wordCount).toBe(5);
  });

  it("keeps summary as the first paragraph of the FIRST document", async () => {
    await seedPersona(db);
    await addDoc(db, "d1", "a.md", "Primary persona blurb.\n\nMore detail here.", 0);
    await addDoc(db, "d2", "b.md", "Second document blurb.", 1);

    await rebuildPersonaIcpText(db, "p1");
    // selectPersona shows `summary` (sliced to 300 chars) to the matching
    // model, so it has to describe the persona, not whichever doc sorts last.
    expect((await readPersona(db)).summary).toBe("Primary persona blurb.");
  });

  it("nulls icpText when the last document is removed, so the persona drops out of matching", async () => {
    await seedPersona(db);
    await addDoc(db, "d1", "a.md", "Only document.", 0);
    await rebuildPersonaIcpText(db, "p1");
    expect((await readPersona(db)).icpText).not.toBeNull();

    await db.delete(icpPersonaDocs).where(eq(icpPersonaDocs.id, "d1"));
    const result = await rebuildPersonaIcpText(db, "p1");

    // selectPersona filters on isNotNull(icpPersonas.icpText) -- an emptied
    // persona must be null, not "".
    expect(result.docCount).toBe(0);
    expect((await readPersona(db)).icpText).toBeNull();
    expect((await readPersona(db)).summary).toBeNull();
  });
});

describe("adoptLegacyIcpTextAsDoc", () => {
  let db: any;
  beforeEach(async () => { db = await makeDb(); });

  it("adopts a pre-multi-doc persona's icpText as document #1", async () => {
    await seedPersona(db, { icpText: "Legacy ICP criteria.", summary: "Legacy ICP criteria." });

    const adopted = await adoptLegacyIcpTextAsDoc(db, {
      id: "p1",
      name: "VP Engineering",
      icpText: "Legacy ICP criteria.",
    });
    expect(adopted).toBe(true);

    const docs = await db.select().from(icpPersonaDocs).orderBy(asc(icpPersonaDocs.sortOrder));
    expect(docs).toHaveLength(1);
    expect(docs[0].text).toBe("Legacy ICP criteria.");
    expect(docs[0].sortOrder).toBe(0);
  });

  it("does not lose legacy text when a new document is added on top of it", async () => {
    // The regression this guards: rebuilding from an empty docs table would
    // wipe the ICP the whole app scores against.
    await seedPersona(db, { icpText: "Legacy ICP criteria.", summary: "Legacy ICP criteria." });
    await adoptLegacyIcpTextAsDoc(db, {
      id: "p1",
      name: "VP Engineering",
      icpText: "Legacy ICP criteria.",
    });

    const order = await nextSortOrder(db, "p1");
    expect(order).toBe(1);
    await addDoc(db, "d2", "new.md", "Newly uploaded criteria.", order);
    await rebuildPersonaIcpText(db, "p1");

    const persona = await readPersona(db);
    expect(persona.icpText).toContain("Legacy ICP criteria.");
    expect(persona.icpText).toContain("Newly uploaded criteria.");
  });

  it("is idempotent — a second call adopts nothing", async () => {
    await seedPersona(db, { icpText: "Legacy ICP criteria." });
    const persona = { id: "p1", name: "VP Engineering", icpText: "Legacy ICP criteria." };

    expect(await adoptLegacyIcpTextAsDoc(db, persona)).toBe(true);
    expect(await adoptLegacyIcpTextAsDoc(db, persona)).toBe(false);
    expect(await db.select().from(icpPersonaDocs)).toHaveLength(1);
  });

  it("does nothing for a persona with no legacy text", async () => {
    await seedPersona(db);
    expect(
      await adoptLegacyIcpTextAsDoc(db, { id: "p1", name: "VP Engineering", icpText: null }),
    ).toBe(false);
    expect(await db.select().from(icpPersonaDocs)).toHaveLength(0);
  });
});

describe("nextSortOrder", () => {
  it("appends after existing documents instead of interleaving", async () => {
    const db = await makeDb();
    await seedPersona(db);
    expect(await nextSortOrder(db, "p1")).toBe(0);
    await addDoc(db, "d1", "a.md", "one", 0);
    await addDoc(db, "d2", "b.md", "two", 1);
    expect(await nextSortOrder(db, "p1")).toBe(2);
  });
});
