// Entry normalization shared by the build-time compile and runtime edits
// (D44). No yaml dependency.
import {
  playbookEntrySchema,
  unknownEntryKeys,
  type ReleaseEntry,
  type UnrecognizedKey,
} from "./schema.js";

export class PlaybookEntryInvalidError extends Error {}

export function toReleaseEntry(raw: Record<string, unknown>): {
  entry: ReleaseEntry;
  unrecognized: UnrecognizedKey[];
} {
  const parsed = playbookEntrySchema.safeParse(raw);
  if (!parsed.success) {
    const where = typeof raw.id === "string" ? raw.id : "entry";
    throw new PlaybookEntryInvalidError(
      `${where}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`,
    );
  }
  const extraKeys = unknownEntryKeys(raw);
  const extra: Record<string, unknown> = {};
  for (const key of extraKeys) extra[key] = raw[key];
  const data = parsed.data;
  const entry: ReleaseEntry = {
    id: data.id,
    type: data.type,
    owner: data.owner,
    version: data.version,
    precedence: data.precedence,
    status: data.status ?? "active",
    body: data.body ?? null,
    params: data.params,
    rationale: data.rationale,
    source: data.source,
    sources: data.sources,
    scope: data.scope,
    review_by: data.review_by,
    examples: data.examples,
    owner_team: data.owner_team,
    block: data.block,
    section: data.section,
    position: data.position,
    needs_fields: data.needs_fields,
    ...(extraKeys.length > 0 ? { extra } : {}),
  };
  return {
    entry,
    unrecognized: extraKeys.map((key) => ({
      entry_id: data.id,
      key,
      value: raw[key],
    })),
  };
}
