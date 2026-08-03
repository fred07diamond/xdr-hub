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
}): string {
  const { cron, enabled, createdBy, ruleId } = params;
  return `---
schedule: "${cron}"
enabled: ${enabled}
createdBy: ${createdBy}
runAs: creator
---
Execute prospecting-hub sourcing rule ${ruleId}: call the run-sourcing-rule-pipeline action with { ruleId: "${ruleId}" }, then report a short summary of how many prospects were found and imported.
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
