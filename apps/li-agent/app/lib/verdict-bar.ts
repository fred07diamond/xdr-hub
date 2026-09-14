/**
 * Client mirror of verdictClearsBar() in
 * server/helpers/apollo-credits/settings.ts.
 *
 * Duplicated rather than imported because that module reads the database and
 * must not enter a client bundle. The server remains the enforcer -- this copy
 * exists only so the UI can COUNT and EXPLAIN what the server will accept,
 * instead of firing a batch and discovering the refusals one by one.
 *
 * Kept behaviourally identical, including the unscored case: a lead with no
 * verdict clears only the loosest bar, because "we have not looked" is not the
 * same as "we looked and it was acceptable".
 */
export type VerdictBar = "strong" | "strong_or_possible" | "not_weak" | "any";

export function verdictClearsBar(
  verdict: string | null | undefined,
  bar: VerdictBar | string | null | undefined,
): boolean {
  if (bar === "any") return true;
  if (!verdict) return false;
  switch (bar) {
    case "strong":
      return verdict === "strong";
    case "strong_or_possible":
      return verdict === "strong" || verdict === "possible";
    case "not_weak":
      return verdict !== "weak";
    default:
      // An unrecognised bar fails closed. A typo in a setting must not quietly
      // authorise every lead.
      return false;
  }
}

/** Plain-language name for a bar, for explaining a skip. */
export function describeBar(bar: VerdictBar | string | null | undefined): string {
  switch (bar) {
    case "strong":
      return "strong fit";
    case "strong_or_possible":
      return "strong or possible fit";
    case "not_weak":
      return "not weak";
    case "any":
      return "any fit";
    default:
      return "the fit bar";
  }
}
