// The Sales handbook (D53): PA's reference docs on the sales cycle and how the
// team works. The content is internal, so it lives only in PA's database, never
// in source. People edit it in the app; every save keeps the prior version.
import {
  VersionConflictError,
  type HandbookDocRecord,
  type HandbookStatus,
  type PaRepository,
} from "../repo/types.js";

export const MAX_DOC_BYTES = 200_000;
export const MAX_IMPORT_FILES = 30;

export class HandbookError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

export interface HandbookDeps {
  repo: PaRepository;
  now: () => Date;
  newId: () => string;
}

export interface ImportFile {
  name: string;
  content: string;
}

export interface ParsedDoc {
  id: string;
  title: string;
  summary: string | null;
  body: string;
  position: number;
  status: HandbookStatus;
}

const slug = (text: string) =>
  text
    .toLowerCase()
    .replace(/\.md$/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

function firstParagraph(body: string): string | null {
  const paragraph = body
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find(
      (block) =>
        block &&
        !block.startsWith("#") &&
        !block.startsWith("|") &&
        !block.startsWith("-") &&
        !block.startsWith("```"),
    );
  if (!paragraph) return null;
  const clean = paragraph
    .replace(/[*_`>]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean.length > 220 ? `${clean.slice(0, 219).trimEnd()}...` : clean;
}

/**
 * The pack's README indexes files as `| 01_name.md | what it covers |`. Those
 * lines are the best summaries, so the importer uses them when present.
 */
export function indexSummaries(readme: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of readme.split("\n")) {
    const match = line.match(/^\|\s*([\w.-]+\.md)\s*\|\s*(.+?)\s*\|\s*$/);
    if (match) out.set(slug(match[1]), match[2]);
  }
  return out;
}

export function parseImportFile(
  file: ImportFile,
  summaries: Map<string, string> = new Map(),
): ParsedDoc {
  const name = file.name.split("/").pop() ?? file.name;
  if (!/\.md$/i.test(name))
    throw new HandbookError(`${name} is not a Markdown (.md) file`);
  const body = file.content.replace(/\r\n/g, "\n").trim();
  if (!body) throw new HandbookError(`${name} is empty`);
  if (new TextEncoder().encode(body).length > MAX_DOC_BYTES)
    throw new HandbookError(`${name} is larger than 200 KB`);
  const id = slug(name);
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? name;
  const number = name.match(/^(\d+)[_-]/)?.[1];
  const isIndex = /readme/i.test(name);
  const title = isIndex
    ? "About this handbook"
    : heading.replace(/^\d+\.\s*/, "").trim();
  const legacy = /^\*\*LEGACY/m.test(body) || /legacy/i.test(heading);
  return {
    id,
    title,
    summary: summaries.get(id) ?? (isIndex ? null : firstParagraph(body)),
    body,
    position: isIndex ? 0 : number ? Number(number) : 100,
    status: isIndex ? "index" : legacy ? "legacy" : "current",
  };
}

/** Adds new docs and updates changed ones; unchanged docs are left alone. */
export async function importDocs(
  deps: HandbookDeps,
  input: { actor: string; files: ImportFile[]; source: string | null },
): Promise<{ added: string[]; updated: string[]; unchanged: string[] }> {
  if (input.files.length === 0) throw new HandbookError("No files to import");
  if (input.files.length > MAX_IMPORT_FILES)
    throw new HandbookError(`Import at most ${MAX_IMPORT_FILES} files at once`);
  const readme = input.files.find((file) => /readme/i.test(file.name));
  const summaries = readme ? indexSummaries(readme.content) : new Map();
  const parsed = input.files.map((file) => parseImportFile(file, summaries));
  const ids = new Set<string>();
  for (const doc of parsed) {
    if (ids.has(doc.id))
      throw new HandbookError(`Two files map to the same doc (${doc.id})`);
    ids.add(doc.id);
  }
  const result = {
    added: [] as string[],
    updated: [] as string[],
    unchanged: [] as string[],
  };
  const at = deps.now().toISOString();
  await deps.repo.transaction(async (tx) => {
    for (const doc of parsed) {
      const current = await tx.getHandbookDoc(doc.id);
      if (!current) {
        await tx.insertHandbookDoc({
          ...doc,
          source: input.source,
          version: 1,
          updatedBy: input.actor,
          createdAt: at,
          updatedAt: at,
        });
        await tx.insertHandbookRevision({
          id: deps.newId(),
          docId: doc.id,
          version: 1,
          title: doc.title,
          body: doc.body,
          editedBy: input.actor,
          note: "Imported",
          createdAt: at,
        });
        result.added.push(doc.id);
        continue;
      }
      if (current.body === doc.body && current.title === doc.title) {
        result.unchanged.push(doc.id);
        continue;
      }
      const next = await tx.updateHandbookDoc(
        doc.id,
        {
          title: doc.title,
          summary: doc.summary,
          body: doc.body,
          status: doc.status,
          source: input.source ?? current.source,
          updatedBy: input.actor,
          updatedAt: at,
        },
        current.version,
      );
      await tx.insertHandbookRevision({
        id: deps.newId(),
        docId: doc.id,
        version: next.version,
        title: doc.title,
        body: doc.body,
        editedBy: input.actor,
        note: "Re-imported",
        createdAt: at,
      });
      result.updated.push(doc.id);
    }
  });
  return result;
}

export async function saveDoc(
  deps: HandbookDeps,
  input: {
    actor: string;
    id: string;
    expectedVersion: number;
    title?: string;
    summary?: string | null;
    status?: HandbookStatus;
    body: string;
    note?: string | null;
  },
): Promise<HandbookDocRecord> {
  const body = input.body.replace(/\r\n/g, "\n").trim();
  if (!body) throw new HandbookError("A handbook doc cannot be empty");
  if (new TextEncoder().encode(body).length > MAX_DOC_BYTES)
    throw new HandbookError("A handbook doc must be under 200 KB");
  const at = deps.now().toISOString();
  try {
    return await deps.repo.transaction(async (tx) => {
      const current = await tx.getHandbookDoc(input.id);
      if (!current) throw new HandbookError("Handbook doc not found", 404);
      const title = input.title?.trim() || current.title;
      const next = await tx.updateHandbookDoc(
        input.id,
        {
          title,
          body,
          ...(input.summary !== undefined ? { summary: input.summary } : {}),
          ...(input.status ? { status: input.status } : {}),
          updatedBy: input.actor,
          updatedAt: at,
        },
        input.expectedVersion,
      );
      await tx.insertHandbookRevision({
        id: deps.newId(),
        docId: input.id,
        version: next.version,
        title,
        body,
        editedBy: input.actor,
        note: input.note?.trim() || null,
        createdAt: at,
      });
      return next;
    });
  } catch (error) {
    if (error instanceof VersionConflictError)
      throw new HandbookError(
        "Someone saved this doc while you were editing. Reload to see their version, then reapply your change.",
        409,
      );
    throw error;
  }
}

/** Plain-text search over titles and bodies, for the agent and the page. */
export function searchDocs(
  docs: HandbookDocRecord[],
  query: string,
  limit = 8,
): Array<{ id: string; title: string; excerpt: string }> {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 1);
  if (terms.length === 0) return [];
  const hits: Array<{
    id: string;
    title: string;
    excerpt: string;
    score: number;
  }> = [];
  for (const doc of docs) {
    const lines = doc.body.split("\n");
    let best = { score: 0, index: -1 };
    lines.forEach((line, index) => {
      const lower = line.toLowerCase();
      const score = terms.filter((term) => lower.includes(term)).length;
      if (score > best.score) best = { score, index };
    });
    const titleScore = terms.filter((term) =>
      doc.title.toLowerCase().includes(term),
    ).length;
    const score = best.score + titleScore * 2;
    if (score === 0) continue;
    const excerpt =
      best.index >= 0
        ? lines
            .slice(best.index, best.index + 3)
            .join(" ")
            .replace(/\s+/g, " ")
            .trim()
            .slice(0, 300)
        : (doc.summary ?? "");
    hits.push({ id: doc.id, title: doc.title, excerpt, score });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ score: _score, ...hit }) => hit);
}
