// Global style rule for every AI-generated message this app produces
// (connection notes, follow-ups, canvas previews): never use em dashes.
// Enforced two ways -- the model is told directly, and the output is
// sanitized afterward as a backstop for when it ignores the instruction.
export const NO_EM_DASH_RULE =
  "Never use em dashes (—) anywhere in your reply. Use a comma, period, or \"and\" instead.";

export function stripEmDashes(text: string): string {
  return text
    .replace(/\s*—\s*/g, ", ")
    .replace(/\s+--\s+/g, ", ")
    .replace(/,\s*,/g, ",")
    .replace(/,(\s*)\./g, ".$1")
    .trim();
}
