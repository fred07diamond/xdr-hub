// JSON columns are TEXT on SQLite and Postgres (schema.ts), so the repository
// encodes on write and decodes on read here, and nowhere else. A value that
// does not parse fails loudly with its column name instead of reaching the
// rules as a string.

export const JSON_COLUMNS = {
  inbox: ["payload"],
  submissions: ["fields", "flags"],
  accounts: ["flags", "firmographics"],
  engagements: ["reviewFlags"],
  events: ["payload"],
  assessments: ["evidenceQuotes"],
  scorecards: ["reasonCodes", "answers", "hypothesis"],
  drafts: ["usedEntryIds", "lint", "editReasons"],
  receipts: ["entryVersions", "ruleResults", "inputs", "toolCalls"],
  outbox: ["payload"],
  releases: ["entries", "content"],
  profiles: ["workingHours", "roles"],
  playbookChanges: ["requiredTeams", "checks", "impact"],
  playbookChangeItems: ["beforeValue", "afterValue"],
  suggestions: ["evidence"],
} as const;

export type JsonTable = keyof typeof JSON_COLUMNS;

const TABLE_NAMES: Record<JsonTable, string> = {
  inbox: "pa_inbox",
  submissions: "pa_submissions",
  accounts: "pa_accounts",
  engagements: "pa_engagements",
  events: "pa_events",
  assessments: "pa_assessments",
  scorecards: "pa_scorecards",
  drafts: "pa_drafts",
  receipts: "pa_receipts",
  outbox: "pa_outbox",
  releases: "pa_playbook_releases",
  profiles: "pa_user_profiles",
  playbookChanges: "pa_playbook_changes",
  playbookChangeItems: "pa_playbook_change_items",
  suggestions: "pa_suggestions",
};

/** Stringifies the table's JSON fields that are present. null and undefined pass through. */
export function encodeJson<Out>(tableName: JsonTable, value: object): Out {
  const out: Record<string, unknown> = { ...value };
  for (const field of JSON_COLUMNS[tableName]) {
    const v = out[field];
    if (v !== undefined && v !== null) out[field] = JSON.stringify(v);
  }
  return out as Out;
}

/** Parses the table's JSON fields. Throws with the column name on bad data. */
export function decodeJson(
  tableName: JsonTable,
  row: object,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...row };
  for (const field of JSON_COLUMNS[tableName]) {
    const v = out[field];
    if (typeof v !== "string") continue;
    try {
      out[field] = JSON.parse(v);
    } catch {
      throw new Error(`${TABLE_NAMES[tableName]}.${field} holds invalid JSON`);
    }
  }
  return out;
}
