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
Execute prospecting-hub sourcing rule ${ruleId}: call the app's sourcing-rule pipeline actions (derive-prospector-filters, search-commonroom-prospects, import-prospects-to-segment) in sequence using that rule's stored parameters, then report a short summary of how many prospects were found and imported.
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
