// Job-resource helpers for sourcing rules' scheduled CommonRoom-Prospector
// pipeline. There is no exported job-content builder or cron validator from
// @agent-native/core (the "./jobs" subpath is not in its package.json
// exports map), so we build/parse the frontmatter+body format ourselves,
// matching the framework scheduler's real (unexported) buildJobContent
// output exactly: `schedule` quoted, `enabled`/`runAs` bare, `---`-fenced
// YAML-ish frontmatter followed by a plain-text instructions body.

/** Compute a daily cron expression that fires `leadHours` before `readyByTime`. */
export function computeSourcingRuleCron(readyByTime: string, leadHours: number): string {
  const [hourStr, minuteStr] = readyByTime.split(":");
  const hour = ((parseInt(hourStr, 10) - leadHours) % 24 + 24) % 24;
  const minute = parseInt(minuteStr, 10);
  return `${minute} ${hour} * * *`;
}

/** Interval-hours values that divide evenly into 24, guaranteeing a predictable, non-drifting recurring schedule. */
export const VALID_INTERVAL_HOURS = [1, 2, 3, 4, 6, 8, 12, 24] as const;

/** Compute a recurring cron expression that fires every `intervalHours` hours, on the hour. */
export function computeIntervalCron(intervalHours: number): string {
  if (!VALID_INTERVAL_HOURS.includes(intervalHours as (typeof VALID_INTERVAL_HOURS)[number])) {
    throw new Error(
      `Invalid intervalHours ${intervalHours}: must be one of ${VALID_INTERVAL_HOURS.join(", ")} hours.`,
    );
  }
  return `0 */${intervalHours} * * *`;
}

export function buildSourcingRuleJobContent(params: {
  cron: string;
  enabled: boolean;
  createdBy: string;
  ruleId: string;
  // The scheduler's runWithRequestContext only carries whatever orgId is in
  // this frontmatter (executeJob reads meta.orgId) — omitting it left every
  // scheduled sourcing-rule run with no org context at all, while a live
  // "Find prospects now" click gets orgId from the real authenticated
  // session. commonroom-client.ts's org-scoped MCP connection requires a
  // real orgId to resolve, so without this a scheduled run's CommonRoom
  // calls fail (confirmed live: "MCP tool is not available in this request
  // scope") in a way a manual click never would.
  orgId?: string | null;
}): string {
  const { cron, enabled, createdBy, ruleId, orgId } = params;
  return `---
schedule: "${cron}"
enabled: ${enabled}
createdBy: ${createdBy}
${orgId ? `orgId: ${orgId}\n` : ""}runAs: creator
---
Execute prospecting-hub sourcing rule ${ruleId}. The run-sourcing-rule-pipeline action is resumable and chunked — ONE call only ever does a small bounded unit of work (a few Prospector search pages, or a small chunk of contact scoring) and returns { done, syncRecordId, phase, recordsFound, scored, remaining, imported, deduped }. You MUST loop it to completion, in this exact sequence:

1. Call run-sourcing-rule-pipeline with { ruleId: "${ruleId}" } (no syncRecordId on this first call).
2. Look at the response's "done" field. If it is false, call run-sourcing-rule-pipeline AGAIN, this time with { ruleId: "${ruleId}", syncRecordId: "<the syncRecordId the previous call just returned>" } — always reuse that same syncRecordId, never omit it and never start a fresh call once you have one.
3. Repeat step 2 — same ruleId, same syncRecordId each time — until a response comes back with "done": true. This can take many calls for a large desiredVolume; keep going as long as "done" is false.
4. Only once "done" is true, report a short summary of how many prospects were found, imported, and scored (use the final call's recordsFound/imported/scored/deduped fields).
`;
}

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

/** Replace a single top-level frontmatter field's value in place, preserving every other line and the body untouched. */
export function updateJobFrontmatterField(content: string, key: "schedule" | "enabled", value: string): string {
  const match = content.match(FRONTMATTER_RE);
  if (!match) {
    throw new Error("Malformed job resource: missing --- frontmatter block");
  }
  const [, yamlBlock, body] = match;
  const lineRe = new RegExp(`^${key}:.*$`, "m");
  if (!lineRe.test(yamlBlock)) {
    throw new Error(`Job resource frontmatter is missing a "${key}" field`);
  }
  const newYamlBlock = yamlBlock.replace(lineRe, `${key}: ${value}`);
  return `---\n${newYamlBlock}\n---\n${body}`;
}

/**
 * Best-effort backfill for a rule's job resource created before orgId was
 * written at all (see buildSourcingRuleJobContent) — those jobs' SCHEDULED
 * runs have no org context, so their CommonRoom MCP calls fail, even though
 * a live "Find prospects now" click (which always carries a real orgId) still
 * succeeds. Called opportunistically from a live-request invocation to patch
 * the job in place so its NEXT scheduled run also has one. No-ops (returns
 * content unchanged) if orgId is already present or the frontmatter is
 * malformed — this must never be the reason a real pipeline run fails.
 */
export function backfillJobOrgId(content: string, orgId: string): string {
  if (/^orgId:/m.test(content)) return content;
  const match = content.match(FRONTMATTER_RE);
  if (!match) return content;
  const [, yamlBlock, body] = match;
  if (!/^runAs:/m.test(yamlBlock)) return content;
  const newYamlBlock = yamlBlock.replace(/^runAs:/m, `orgId: ${orgId}\nrunAs:`);
  return `---\n${newYamlBlock}\n---\n${body}`;
}
