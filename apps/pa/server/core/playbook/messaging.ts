// The playbook's Messaging section as the drafting agent reads it (D65): the
// TCQ rubric, voice, questions, and each class's formula live in playbook
// message rules, editable in the Playbook, instead of in the skill. Shared
// rules always apply; a class block applies to its class only.
import type { PlaybookRelease, ReleaseEntry } from "./schema.js";

const HIDDEN = new Set(["retired", "missing", "draft"]);

export interface MessagingRule {
  id: string;
  version: number;
  appliesTo: string | null;
  body: string | null;
  params: Record<string, unknown> | null;
}

function appliesTo(entry: ReleaseEntry): string | null {
  const scope = entry.scope ?? {};
  if (typeof scope.approach === "string") return scope.approach;
  if (scope.relationship_state === "agency") return "agency";
  return null;
}

const position = (entry: ReleaseEntry) =>
  entry.position ?? Number.MAX_SAFE_INTEGER;

export function messagingGuide(
  release: PlaybookRelease,
  approach: string | null,
): { releaseShortId: string; approach: string | null; rules: MessagingRule[] } {
  const rules = release.entries
    .filter((entry) => entry.type === "message_rule")
    .filter((entry) => !HIDDEN.has(entry.status ?? "active"))
    .filter((entry) => {
      const target = appliesTo(entry);
      return target === null || approach === null || target === approach;
    })
    .sort((a, b) => position(a) - position(b))
    .map((entry) => ({
      id: entry.id,
      version: entry.version,
      appliesTo: appliesTo(entry),
      body: entry.body ?? null,
      params: (entry.params as Record<string, unknown> | undefined) ?? null,
    }));
  return { releaseShortId: release.short_id, approach, rules };
}
