// Build-time only (scripts and tests). Runtime code imports the compiled JSON.
// yaml API: https://eemeli.org/yaml/#documents and https://eemeli.org/yaml/#visit
import {
  isMap,
  isPair,
  isScalar,
  isSeq,
  parseDocument,
  visit,
  type Document,
  type Node as YamlNode,
} from "yaml";

import {
  PlaybookEntryInvalidError,
  toReleaseEntry as normalizeEntry,
} from "./entries.js";
import { canonicalJson, sha256Hex } from "./hash.js";
import {
  playbookEntrySchema,
  playbookFileSchema,
  playbookReleaseSchema,
  releaseContentSchema,
  unknownEntryKeys,
  type PendingConfirmation,
  type PlaybookRelease,
  type ReleaseContent,
  type ReleaseEntry,
  type UnrecognizedKey,
} from "./schema.js";

export interface SourceFile {
  path: string;
  text: string;
}

export interface CompileInput {
  playbooks: SourceFile[];
  routingPool: SourceFile;
  hubspotMapping: SourceFile;
}

export class PlaybookCompileError extends Error {}

export { canonicalJson, sha256Hex };

function parse(file: SourceFile): Document {
  const doc = parseDocument(file.text, { prettyErrors: true });
  if (doc.errors.length > 0) {
    throw new PlaybookCompileError(
      `${file.path}: ${doc.errors.map((error) => error.message).join("; ")}`,
    );
  }
  return doc;
}

function hasTodo(text: string | null | undefined): boolean {
  return typeof text === "string" && /\bTODO\b/.test(text);
}

function logicalPath(ancestors: readonly unknown[], node: unknown): string[] {
  const parts: string[] = [];
  const chain = [...ancestors, node];
  for (let index = 0; index < chain.length; index += 1) {
    const current = chain[index];
    const next = chain[index + 1];
    if (isPair(current)) {
      const key = isScalar(current.key) ? String(current.key.value) : "?";
      if (next === current.value || next === undefined) parts.push(key);
    } else if (isSeq(current) && next !== undefined) {
      const position = current.items.indexOf(next as never);
      if (position >= 0) parts.push(String(position));
    }
  }
  return parts;
}

function collectTodos(
  doc: Document,
  source: string,
  resolveEntryId: (path: string[]) => string | null,
): PendingConfirmation[] {
  const found: PendingConfirmation[] = [];
  const seen = new Set<string>();
  const record = (
    ancestors: readonly unknown[],
    node: YamlNode,
    note: string,
  ) => {
    const path = logicalPath(ancestors, node);
    const key = path.join(".");
    if (seen.has(key)) return;
    seen.add(key);
    const entryId = resolveEntryId(path);
    const localPath =
      entryId && path[0] === "entries" ? path.slice(2).join(".") : key;
    found.push({
      source,
      entry_id: entryId,
      path: localPath,
      value: node.toJSON(),
      note: note.trim(),
    });
  };
  visit(doc, {
    Scalar(_key, node, ancestors) {
      if (node.value === "TODO") {
        record(ancestors, node, node.comment ?? "Value is TODO");
      } else if (hasTodo(node.comment)) {
        record(ancestors, node, node.comment ?? "");
      }
    },
    Seq(_key, node, ancestors) {
      if (hasTodo(node.comment)) record(ancestors, node, node.comment ?? "");
    },
    Map(_key, node, ancestors) {
      if (ancestors.length > 0 && hasTodo(node.comment)) {
        record(ancestors, node, node.comment ?? "");
      }
    },
  });
  return found;
}

function entryIdResolver(entries: unknown[]) {
  return (path: string[]): string | null => {
    if (path[0] !== "entries" || path[1] === undefined) return null;
    const entry = entries[Number(path[1])];
    if (entry && typeof entry === "object" && "id" in entry) {
      return String((entry as { id: unknown }).id);
    }
    return null;
  };
}

function toReleaseEntry(raw: Record<string, unknown>) {
  try {
    return normalizeEntry(raw);
  } catch (error) {
    if (error instanceof PlaybookEntryInvalidError)
      throw new PlaybookCompileError(error.message);
    throw error;
  }
}

export function compilePlaybook(input: CompileInput): PlaybookRelease {
  const entries: ReleaseEntry[] = [];
  const unrecognized: UnrecognizedKey[] = [];
  const pending: PendingConfirmation[] = [];
  const notes: string[] = [];

  for (const file of input.playbooks) {
    const doc = parse(file);
    const parsedFile = playbookFileSchema.safeParse(doc.toJSON());
    if (!parsedFile.success) {
      throw new PlaybookCompileError(
        `${file.path}: ${parsedFile.error.issues.map((issue) => issue.message).join("; ")}`,
      );
    }
    if (parsedFile.data.release_notes)
      notes.push(parsedFile.data.release_notes);
    for (const raw of parsedFile.data.entries) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new PlaybookCompileError(
          `${file.path}: every entry must be a map`,
        );
      }
      const { entry, unrecognized: extra } = toReleaseEntry(
        raw as Record<string, unknown>,
      );
      if (entries.some((existing) => existing.id === entry.id)) {
        throw new PlaybookCompileError(`Duplicate entry id ${entry.id}`);
      }
      entries.push(entry);
      unrecognized.push(...extra);
    }
    pending.push(
      ...collectTodos(doc, file.path, entryIdResolver(parsedFile.data.entries)),
    );
  }

  const poolDoc = parse(input.routingPool);
  const poolJson = poolDoc.toJSON() as { pool?: unknown };
  if (!Array.isArray(poolJson?.pool)) {
    throw new PlaybookCompileError(
      `${input.routingPool.path}: pool must be a list of emails`,
    );
  }
  pending.push(...collectTodos(poolDoc, input.routingPool.path, () => null));

  const mappingDoc = parse(input.hubspotMapping);
  const mappingJson = mappingDoc.toJSON();
  if (!isMap(mappingDoc.contents)) {
    throw new PlaybookCompileError(
      `${input.hubspotMapping.path}: expected a map`,
    );
  }
  pending.push(
    ...collectTodos(mappingDoc, input.hubspotMapping.path, () => null),
  );

  const content: ReleaseContent = releaseContentSchema.parse({
    schema: 1,
    release_notes: notes.join("\n"),
    entries,
    config: {
      routing_pool: { pool: poolJson.pool.map(String) },
      hubspot_mapping: mappingJson as Record<string, unknown>,
    },
    pending_confirmation: pending,
    unrecognized_keys: unrecognized,
  });

  const id = sha256Hex(canonicalJson(content));
  return playbookReleaseSchema.parse({
    ...content,
    id,
    short_id: id.slice(0, 8),
    sources: [...input.playbooks, input.routingPool, input.hubspotMapping].map(
      (file) => ({ path: file.path, sha256: sha256Hex(file.text) }),
    ),
  });
}

export function serializeRelease(release: PlaybookRelease): string {
  return `${JSON.stringify(release, null, 2)}\n`;
}
