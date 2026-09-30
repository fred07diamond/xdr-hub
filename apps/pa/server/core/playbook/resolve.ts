import { z } from "zod";

import { PRECHECK_OUTCOMES } from "../objects/index.js";
import type {
  Citation,
  PendingConfirmation,
  PlaybookRelease,
  ReleaseEntry,
} from "./schema.js";

export class PlaybookEntryError extends Error {}

export function findEntry(
  release: PlaybookRelease,
  id: string,
): ReleaseEntry | null {
  return release.entries.find((entry) => entry.id === id) ?? null;
}

export function requireEntry(
  release: PlaybookRelease,
  id: string,
): ReleaseEntry {
  const entry = findEntry(release, id);
  if (!entry) {
    throw new PlaybookEntryError(
      `Release ${release.short_id} has no entry ${id}`,
    );
  }
  return entry;
}

export function cite(entry: ReleaseEntry): Citation {
  return { id: entry.id, version: entry.version };
}

export function uniqueCitations(citations: Citation[]): Citation[] {
  const seen = new Map<string, Citation>();
  for (const citation of citations) seen.set(citation.id, citation);
  return [...seen.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function pendingFor(
  release: PlaybookRelease,
  entryId: string,
): PendingConfirmation[] {
  return release.pending_confirmation.filter(
    (item) => item.entry_id === entryId,
  );
}

export function isTodo(value: unknown): boolean {
  return (
    value === "TODO" || value === null || value === undefined || value === ""
  );
}

const precheckOutcomeParams = z.record(z.string(), z.enum(PRECHECK_OUTCOMES));

export const ruleParamSchemas = {
  "rule.crm.system": z.object({ system: z.enum(["hubspot", "salesforce"]) }),
  "rule.precheck.outcomes": precheckOutcomeParams,
  "rule.precheck.restricted_countries": z.object({
    countries: z.array(z.string()),
  }),
  "rule.routing.order": z.object({
    order: z.array(z.string()).min(1),
    agency_partner_rep: z.string(),
    round_robin_pool: z.string(),
  }),
  "rule.routing.by_class": z.record(
    z.string(),
    z.enum(["route_to_ae", "pa_meeting", "qualify_first", "agency"]),
  ),
  "rule.routing.sal_stale_days": z.object({
    days: z.number().int().positive(),
  }),
  "rule.sla.first_touch": z.object({
    minutes: z.number().int().positive(),
    clock: z.literal("owner_working_hours"),
    reminder_at_fraction: z.number().gt(0).lt(1),
    breach_notify: z.string(),
  }),
  "rule.sla.decision": z.object({ hours: z.number().positive() }),
  "rule.enterprise.bar": z.object({
    code_min_seats: z.number().int().positive(),
  }),
} as const;

export type RuleId = keyof typeof ruleParamSchemas;
export type RuleParams<Id extends RuleId> = z.infer<
  (typeof ruleParamSchemas)[Id]
>;

export interface ResolvedRule<Id extends RuleId> {
  entry: ReleaseEntry;
  params: RuleParams<Id>;
  citation: Citation;
  pending: PendingConfirmation[];
}

export function rule<Id extends RuleId>(
  release: PlaybookRelease,
  id: Id,
): ResolvedRule<Id> {
  const entry = requireEntry(release, id);
  const parsed = ruleParamSchemas[id].safeParse(entry.params ?? {});
  if (!parsed.success) {
    throw new PlaybookEntryError(
      `${id} v${entry.version} has invalid params: ${parsed.error.issues
        .map((issue) => `${issue.path.join(".")} ${issue.message}`)
        .join("; ")}`,
    );
  }
  return {
    entry,
    params: parsed.data as RuleParams<Id>,
    citation: cite(entry),
    pending: pendingFor(release, id),
  };
}

export function definition(release: PlaybookRelease, id: `def.${string}`) {
  const entry = requireEntry(release, id);
  return { entry, citation: cite(entry) };
}

export function entrySummary(entry: ReleaseEntry) {
  return {
    id: entry.id,
    type: entry.type,
    version: entry.version,
    owner: entry.owner,
    status: entry.status ?? "active",
    precedence: entry.precedence ?? null,
    scope: entry.scope ?? null,
  };
}
