import { z } from "zod";

import {
  BLOCK_TYPE_IDS,
  SECTION_IDS,
} from "../../../shared/playbook-blocks.js";

export const ENTRY_TYPES = [
  "definition",
  "rule",
  "message_rule",
  "knowledge",
  "view",
] as const;

/** Who approves changes to an entry (D44). "both" needs both teams. */
export const OWNER_TEAMS = ["pa_team", "revops", "both"] as const;
export type OwnerTeam = (typeof OWNER_TEAMS)[number];

export const ENTRY_STATUSES = [
  "active",
  "missing",
  "draft",
  "retired",
  // Published, but code has no evaluator yet, so it is never enforced.
  "pending_build",
] as const;

const KNOWN_ENTRY_KEYS = new Set([
  "id",
  "type",
  "owner",
  "version",
  "precedence",
  "status",
  "body",
  "params",
  "rationale",
  "source",
  "sources",
  "scope",
  "review_by",
  "examples",
  "owner_team",
  "needs_fields",
  "block",
  "section",
  "position",
]);

export const playbookEntrySchema = z
  .object({
    id: z
      .string()
      .regex(
        /^(def|rule|msg|kb|view)\.[a-z0-9_]+(\.[a-z0-9_]+)*$/,
        "Entry ids look like def.ql, rule.precheck.outcomes, or view.board",
      ),
    type: z.enum(ENTRY_TYPES),
    owner: z.string().min(1),
    version: z.number().int().positive(),
    precedence: z.number().int().min(1).max(5).optional(),
    status: z.enum(ENTRY_STATUSES).optional(),
    body: z.string().nullable().optional(),
    params: z.record(z.string(), z.unknown()).optional(),
    rationale: z.string().optional(),
    source: z.string().optional(),
    sources: z.array(z.string()).optional(),
    scope: z.record(z.string(), z.unknown()).optional(),
    review_by: z.string().optional(),
    examples: z.array(z.unknown()).optional(),
    owner_team: z.enum(OWNER_TEAMS),
    // Canonical CRM fields a rule needs that code may not read yet, e.g.
    // "company.employees". Unknown ones become requests to RevOps (D44).
    needs_fields: z.array(z.string().regex(/^[a-z]+\.[a-z_]+$/)).optional(),
    // The block type, its section, and its place in the section (D46).
    block: z.enum(BLOCK_TYPE_IDS),
    section: z.enum(SECTION_IDS),
    position: z.number().int().min(0).optional(),
  })
  .loose()
  .superRefine((entry, ctx) => {
    if (entry.type === "rule" && !entry.params) {
      ctx.addIssue({
        code: "custom",
        message: `${entry.id}: rules need params`,
      });
    }
    if (entry.type === "view" && !entry.params) {
      ctx.addIssue({
        code: "custom",
        message: `${entry.id}: views need params`,
      });
    }
    if (entry.type === "definition" && !entry.body) {
      ctx.addIssue({
        code: "custom",
        message: `${entry.id}: definitions need a body`,
      });
    }
    if (
      entry.type === "knowledge" &&
      entry.status !== "missing" &&
      !entry.body
    ) {
      ctx.addIssue({
        code: "custom",
        message: `${entry.id}: knowledge entries need a body unless status is missing`,
      });
    }
  });

export const playbookFileSchema = z.object({
  release_notes: z.string().optional(),
  entries: z.array(z.unknown()).min(1),
});

export function unknownEntryKeys(raw: Record<string, unknown>): string[] {
  return Object.keys(raw).filter((key) => !KNOWN_ENTRY_KEYS.has(key));
}

export const citationSchema = z.object({
  id: z.string(),
  version: z.number().int(),
});
export type Citation = z.infer<typeof citationSchema>;

export const releaseEntrySchema = z.object({
  id: z.string(),
  type: z.enum(ENTRY_TYPES),
  owner: z.string(),
  version: z.number().int(),
  precedence: z.number().int().optional(),
  status: z.enum(ENTRY_STATUSES).optional(),
  body: z.string().nullable().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  rationale: z.string().optional(),
  source: z.string().optional(),
  sources: z.array(z.string()).optional(),
  scope: z.record(z.string(), z.unknown()).optional(),
  review_by: z.string().optional(),
  examples: z.array(z.unknown()).optional(),
  owner_team: z.enum(OWNER_TEAMS),
  needs_fields: z.array(z.string()).optional(),
  // Optional here so releases stored before D46 still load.
  block: z.string().optional(),
  section: z.string().optional(),
  position: z.number().int().optional(),
  extra: z.record(z.string(), z.unknown()).optional(),
});
export type ReleaseEntry = z.infer<typeof releaseEntrySchema>;

export const pendingConfirmationSchema = z.object({
  source: z.string(),
  entry_id: z.string().nullable(),
  path: z.string(),
  value: z.unknown(),
  note: z.string(),
});
export type PendingConfirmation = z.infer<typeof pendingConfirmationSchema>;

export const unrecognizedKeySchema = z.object({
  entry_id: z.string(),
  key: z.string(),
  value: z.unknown(),
});
export type UnrecognizedKey = z.infer<typeof unrecognizedKeySchema>;

export const releaseContentSchema = z.object({
  schema: z.literal(1),
  release_notes: z.string(),
  entries: z.array(releaseEntrySchema),
  config: z.object({
    routing_pool: z.object({ pool: z.array(z.string()) }),
    hubspot_mapping: z.record(z.string(), z.unknown()),
  }),
  pending_confirmation: z.array(pendingConfirmationSchema),
  unrecognized_keys: z.array(unrecognizedKeySchema),
});
export type ReleaseContent = z.infer<typeof releaseContentSchema>;

export const playbookReleaseSchema = releaseContentSchema.extend({
  id: z.string().regex(/^[0-9a-f]{64}$/),
  short_id: z.string().length(8),
  sources: z.array(z.object({ path: z.string(), sha256: z.string() })),
});
export type PlaybookRelease = z.infer<typeof playbookReleaseSchema>;
