import {
  mappingProblems,
  type PortalSchema,
} from "../../../shared/crm-mapping.js";
import { blockType } from "../../../shared/playbook-blocks.js";
// Checks on a playbook change, in code, before anyone approves it (D44).
// Errors block publishing. Findings become suggestions addressed to the app
// owner (build something), RevOps (add or map a CRM field), or the PA team
// (fill a knowledge gap). Pure: no I/O.
import type {
  ChangeItemRecord,
  SuggestionAudience,
  SuggestionKind,
} from "../repo/types.js";
import {
  CANONICAL_CRM_FIELDS,
  evaluatorFor,
  GUIDANCE_TYPES,
} from "./capabilities.js";
import { isTodo } from "./resolve.js";
import type { PlaybookRelease, ReleaseEntry } from "./schema.js";
import {
  buildRelease,
  CONFIG_TARGETS,
  ReleaseBuildError,
  type ConfigTarget,
} from "./store.js";

export type Team = "pa_team" | "revops" | "admin";

/**
 * Who approves playbook edits (D76): the app owner, or a Playbook admin the
 * owner assigns. Owning teams stay on entries as who to ask, not who approves.
 */
export const APPROVER: Team = "admin";

export interface Finding {
  kind: SuggestionKind;
  audience: SuggestionAudience;
  target: string;
  title: string;
  body: string;
  dedupeKey: string;
  evidence: Record<string, unknown>;
}

export interface CheckResult {
  ok: boolean;
  errors: { target: string; message: string }[];
  findings: Finding[];
  /** Rule entries that publish as pending_build: no evaluator in code yet. */
  pendingBuild: string[];
  requiredTeams: Team[];
  release: PlaybookRelease | null;
}

const teamsOf = (ownerTeam: string | undefined): Team[] =>
  ownerTeam === "both"
    ? ["pa_team", "revops"]
    : ownerTeam === "pa_team" || ownerTeam === "revops"
      ? [ownerTeam]
      : [];

/**
 * Every team that owns an entry before or after the change approves it, so a
 * team cannot take over the other team's entry by changing its owner_team.
 */
export function requiredTeamsFor(
  base: PlaybookRelease,
  items: ChangeItemRecord[],
): Team[] {
  return items.length > 0 ? [APPROVER] : [];
}

/** The owning teams a change touches, for context on the change page. */
export function owningTeamsFor(
  base: PlaybookRelease,
  items: ChangeItemRecord[],
): Team[] {
  const teams = new Set<Team>();
  for (const item of items) {
    if (item.op === "set_config") {
      const owner = CONFIG_TARGETS[item.target as ConfigTarget];
      if (owner) teams.add(owner);
      continue;
    }
    const before = base.entries.find((entry) => entry.id === item.target);
    for (const team of teamsOf(before?.owner_team)) teams.add(team);
    const after = item.afterValue as { owner_team?: string } | null;
    for (const team of teamsOf(after?.owner_team)) teams.add(team);
  }
  return [...teams].sort();
}

function mappingValue(mapping: Record<string, unknown>, path: string): unknown {
  let current: unknown = mapping;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function crmFindings(
  entry: ReleaseEntry,
  fields: readonly string[],
  mapping: Record<string, unknown>,
): Finding[] {
  const out: Finding[] = [];
  for (const field of fields) {
    const known = CANONICAL_CRM_FIELDS[field];
    if (!known) {
      out.push({
        kind: "crm_field",
        audience: "revops",
        target: entry.id,
        title: `A CRM field is needed: ${field}`,
        body: `${entry.id} needs ${field}, which the CRM does not expose to PA yet. Please confirm or create the HubSpot property and add it to the HubSpot mapping.`,
        dedupeKey: `crm_field:new:${field}`,
        evidence: { entry: entry.id, field },
      });
      out.push({
        kind: "feature",
        audience: "app_owner",
        target: entry.id,
        title: `Read ${field} in the CRM adapter`,
        body: `${entry.id} needs ${field}. Add it to the canonical CRM snapshot and the HubSpot adapter, then to CANONICAL_CRM_FIELDS and the rule's evaluator.`,
        dedupeKey: `feature:crm_read:${field}`,
        evidence: { entry: entry.id, field },
      });
      continue;
    }
    if (known.mapping === null) continue;
    const value = mappingValue(mapping, known.mapping);
    if (isTodo(value)) {
      out.push({
        kind: "crm_field",
        audience: "revops",
        target: entry.id,
        title: `Map the ${known.label} in the HubSpot mapping`,
        body: `${entry.id} reads ${known.label}, but config.hubspot_mapping has no property for ${known.mapping}. Until it is mapped, PA cannot read this field from HubSpot.`,
        dedupeKey: `crm_field:map:${field}`,
        evidence: { entry: entry.id, field, mappingPath: known.mapping },
      });
    }
  }
  return out;
}

/** Findings for one entry, as published in `release`. */
function entryFindings(
  entry: ReleaseEntry,
  release: PlaybookRelease,
  before: ReleaseEntry | undefined,
): Finding[] {
  if (entry.status === "retired") return [];
  const findings: Finding[] = [];
  const mapping = release.config.hubspot_mapping;

  if (entry.type === "knowledge" && entry.status === "missing") {
    findings.push({
      kind: "knowledge",
      audience: "pa_team",
      target: entry.id,
      title: `Write the knowledge entry ${entry.id}`,
      body: `${entry.id} is marked missing. Drafts that need it say what will be confirmed instead of answering.`,
      dedupeKey: `knowledge:${entry.id}`,
      evidence: { entry: entry.id },
    });
  }
  if (entry.type === "view") {
    findings.push({
      kind: "feature",
      audience: "app_owner",
      target: entry.id,
      title: `Support the view ${entry.id}`,
      body: `${entry.id} describes how the team wants information laid out, and the app does not render view entries yet.`,
      dedupeKey: `feature:view:${entry.id}`,
      evidence: { entry: entry.id, params: entry.params ?? null },
    });
  }
  if (entry.type !== "rule") {
    if (!GUIDANCE_TYPES.has(entry.type) && entry.type !== "view") {
      findings.push({
        kind: "feature",
        audience: "app_owner",
        target: entry.id,
        title: `Handle entry type ${entry.type}`,
        body: `${entry.id} has a type the app does not know.`,
        dedupeKey: `feature:type:${entry.type}`,
        evidence: { entry: entry.id },
      });
    }
    return findings;
  }

  const evaluator = evaluatorFor(entry.id);
  if (!evaluator) {
    findings.push({
      kind: "feature",
      audience: "app_owner",
      target: entry.id,
      title: `Build an evaluator for ${entry.id}`,
      body: [
        `${entry.id} is published but not enforced: code has no evaluator for it.`,
        entry.body ? `What it says: ${entry.body}` : null,
        entry.rationale ? `Why: ${entry.rationale}` : null,
        `Params: ${JSON.stringify(entry.params ?? {})}`,
        blockType(entry.block)
          ? `How to build it (${blockType(entry.block)!.label} block): ${blockType(entry.block)!.brief}`
          : "Add a param schema in resolve.ts, the rule function, an EVALUATORS entry, and tests.",
        "Then register it in capabilities.ts so the playbook shows it as enforced.",
      ]
        .filter(Boolean)
        .join("\n"),
      dedupeKey: `feature:rule:${entry.id}`,
      evidence: {
        entry: entry.id,
        params: entry.params ?? null,
        owner: entry.owner,
      },
    });
    findings.push(...crmFindings(entry, entry.needs_fields ?? [], mapping));
    return findings;
  }

  const params = (entry.params ?? {}) as Record<string, unknown>;
  const previous = (before?.params ?? {}) as Record<string, unknown>;
  for (const key of Object.keys(params)) {
    if (evaluator.reads.includes(key)) continue;
    if (JSON.stringify(params[key]) === JSON.stringify(previous[key])) continue;
    findings.push({
      kind: "feature",
      audience: "app_owner",
      target: entry.id,
      title: `Enforce ${entry.id} ${key}`,
      body: `${key} on ${entry.id} is set to ${JSON.stringify(params[key])}, but code does not read it, so it has no effect yet.`,
      dedupeKey: `feature:param:${entry.id}.${key}`,
      evidence: { entry: entry.id, key, value: params[key] },
    });
  }
  for (const [key, values] of Object.entries(evaluator.supported ?? {})) {
    const value = params[key];
    if (typeof value === "string" && !values.includes(value)) {
      findings.push({
        kind: "feature",
        audience: "app_owner",
        target: entry.id,
        title: `Support ${key} ${value} for ${entry.id}`,
        body: `${entry.id} sets ${key} to ${value}, which code does not support yet (supported: ${values.join(", ")}).${
          blockType(entry.block)
            ? ` How to build it: ${blockType(entry.block)!.brief}`
            : ""
        }`,
        dedupeKey: `feature:value:${entry.id}.${key}.${value}`,
        evidence: { entry: entry.id, key, value },
      });
    }
  }
  const signals = evaluator.knownValues?.signals;
  if (signals) {
    for (const key of Object.keys(params)) {
      if (!signals.includes(key) && !evaluator.reads.includes(key)) {
        findings.push({
          kind: "feature",
          audience: "app_owner",
          target: entry.id,
          title: `Detect the pre-check signal ${key}`,
          body: `${entry.id} maps ${key} to ${String(params[key])}, but code has no rule function for ${key}.`,
          dedupeKey: `feature:signal:${key}`,
          evidence: { entry: entry.id, signal: key },
        });
      }
    }
  }
  const steps = evaluator.knownValues?.order;
  if (steps && Array.isArray(params.order)) {
    for (const step of params.order as unknown[]) {
      if (typeof step === "string" && !steps.includes(step)) {
        findings.push({
          kind: "feature",
          audience: "app_owner",
          target: entry.id,
          title: `Build the routing step ${step}`,
          body: `${entry.id} lists ${step}, which has no routing function, so routing skips it.`,
          dedupeKey: `feature:route_step:${step}`,
          evidence: { entry: entry.id, step },
        });
      }
    }
  }
  findings.push(
    ...crmFindings(
      entry,
      [...evaluator.crmFields, ...(entry.needs_fields ?? [])],
      mapping,
    ),
  );
  return findings;
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Map<string, Finding>();
  for (const finding of findings)
    if (!seen.has(finding.dedupeKey)) seen.set(finding.dedupeKey, finding);
  return [...seen.values()];
}

export function checkChange(
  base: PlaybookRelease,
  items: ChangeItemRecord[],
  changeId: string,
  notes: string,
  /** The portal's property definitions, when refreshed (D48). */
  portal: PortalSchema | null = null,
): CheckResult {
  const errors: CheckResult["errors"] = [];
  const requiredTeams = requiredTeamsFor(base, items);
  if (items.length === 0)
    errors.push({ target: "change", message: "The change has no items" });

  // Rule entries code cannot evaluate publish as pending_build, never silently.
  const pendingBuild = items
    .filter((item) => item.op === "add" || item.op === "update")
    .filter(
      (item) => (item.afterValue as { type?: string } | null)?.type === "rule",
    )
    .map((item) => item.target)
    .filter((id) => !evaluatorFor(id));

  let release: PlaybookRelease | null = null;
  try {
    release = buildRelease({
      base,
      items,
      changeId,
      notes,
      pendingBuild: new Set(pendingBuild),
    });
  } catch (error) {
    if (!(error instanceof ReleaseBuildError)) throw error;
    errors.push({ target: "change", message: error.message });
  }

  const findings: Finding[] = [];
  if (release) {
    const mappingChanged = items.some(
      (item) => item.target === "config.hubspot_mapping",
    );
    const touched = new Set(
      items
        .filter((item) => item.op !== "set_config")
        .map((item) => item.target),
    );
    for (const entry of release.entries) {
      if (!touched.has(entry.id) && !(mappingChanged && entry.type === "rule"))
        continue;
      if (touched.has(entry.id) && entry.status !== "retired") {
        const type = blockType(entry.block);
        if (!type) {
          errors.push({
            target: entry.id,
            message: `Unknown block type ${entry.block ?? "(none)"}`,
          });
        } else {
          const data = type.schema.safeParse(entry.params ?? {});
          if (!data.success) {
            errors.push({
              target: entry.id,
              message: `${type.label}: ${data.error.issues.map((issue) => `${issue.path.join(".") || "data"} ${issue.message}`).join("; ")}`,
            });
          }
          if (type.body === "required" && !entry.body)
            errors.push({
              target: entry.id,
              message: `${type.label} needs text`,
            });
          if (
            type.storage.kind === "entry" &&
            type.storage.entryType !== entry.type
          ) {
            errors.push({
              target: entry.id,
              message: `A ${type.label} block is a ${type.storage.entryType} entry, not ${entry.type}`,
            });
          }
        }
      }
      if (
        touched.has(entry.id) &&
        entry.type === "rule" &&
        entry.status !== "retired"
      ) {
        const evaluator = evaluatorFor(entry.id);
        const parsed = evaluator?.paramSchema.safeParse(entry.params ?? {});
        if (parsed && !parsed.success) {
          errors.push({
            target: entry.id,
            message: parsed.error.issues
              .map(
                (issue) =>
                  `${issue.path.join(".") || "params"}: ${issue.message}`,
              )
              .join("; "),
          });
        }
      }
      findings.push(
        ...entryFindings(
          entry,
          release,
          base.entries.find((item) => item.id === entry.id),
        ),
      );
    }
  }
  if (release && portal) {
    // A mapping change must point at properties that exist and fit. A problem
    // that was already there becomes a RevOps request instead of blocking an
    // unrelated change.
    const mappingChanged = items.some(
      (item) => item.target === "config.hubspot_mapping",
    );
    for (const problem of mappingProblems(
      release.config.hubspot_mapping,
      portal,
    )) {
      if (mappingChanged) {
        errors.push({
          target: "config.hubspot_mapping",
          message: `${problem.field}: ${problem.message}`,
        });
      } else {
        findings.push({
          kind: "crm_field",
          audience: "revops",
          target: "config.hubspot_mapping",
          title: `Fix the mapping for ${problem.field}`,
          body: `${problem.message}. Update the CRM field mapping block so PA reads the right property.`,
          dedupeKey: `crm_field:portal:${problem.field}`,
          evidence: { field: problem.field },
        });
      }
    }
  }
  return {
    ok: errors.length === 0,
    errors,
    findings: dedupe(findings),
    pendingBuild,
    requiredTeams,
    release,
  };
}

/** Every finding for a whole release, for the capability view and the seed import. */
export function auditRelease(release: PlaybookRelease): Finding[] {
  return dedupe(
    release.entries.flatMap((entry) =>
      entryFindings(entry, release, undefined),
    ),
  );
}
