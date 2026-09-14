// CSV builder shared by the Prospects page's "Export CSV" button
// (app/routes/_index.tsx). Same column shape as the extension's per-list
// Apollo export (buildApolloCsv in extension/panel.js), so a rep gets one
// consistent format whether exporting a single list or everything at once.
export interface CsvRow {
  name: string | null;
  company: string | null;
  headline: string | null;
  location: string | null;
  profileUrl: string | null;
  salesNavLeadUrl: string | null;
  enrichedTitle: string | null;
  enrichedEmail: string | null;
  enrichedPhone: string | null;
  enrichedLinkedinUrl: string | null;
}

/** Exported so new CSV exports reuse it rather than adding a fourth copy. */
export function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/**
 * Mirrors EMOJI_PATTERN in server/helpers/apollo-client.ts.
 *
 * Duplicated rather than imported because that module is server-only (it
 * carries the Apollo key handling), and a client bundle must not pull it in.
 * Kept byte-identical so the two cannot disagree about what an emoji is.
 */
const EMOJI_PATTERN = new RegExp(
  "\\p{Extended_Pictographic}|\\u{FE0F}|\\u{200D}|[\\u{1F1E6}-\\u{1F1FF}]",
  "gu",
);

/**
 * Strips emoji and collapses the whitespace they leave behind.
 *
 * LinkedIn names routinely carry them ("👋 Liam Bolton", "Jane Doe 🚀"), and
 * without this the split put the emoji in First Name and the entire real name
 * in Last Name -- so the export looked corrupt and Apollo would match on a
 * first name of "👋". apollo-client.ts already does this before calling
 * Apollo; the CSV path did not, which is why it only showed up on export.
 */
function cleanName(name: string | null): string {
  if (!name) return "";
  return name.replace(EMOJI_PATTERN, "").replace(/\s{2,}/g, " ").trim();
}

function splitName(name: string | null): { first: string; last: string } {
  const cleaned = cleanName(name);
  if (!cleaned) return { first: "", last: "" };
  const parts = cleaned.split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

/**
 * The column order, exported so the export-preview modal renders the REAL
 * header instead of a hand-copied duplicate that could drift from the file.
 *
 * "Mobile Phone" rather than "Phone": Apollo's importer does not map a bare
 * "Phone" to its mobile-phone field, so the number was dropped on import and
 * then re-fetched, paying twice for data we already had.
 */
export const CSV_HEADER = [
  "First Name",
  "Last Name",
  "Company",
  "Title",
  "Email",
  "Mobile Phone",
  "LinkedIn Url",
  "Location",
] as const;

/**
 * One row's values, in CSV_HEADER order, UNESCAPED.
 *
 * Split out from buildMasterCsv so the export-preview modal can render the
 * exact cells the file will contain. The alternative -- building the CSV text
 * and splitting it on commas -- is subtly wrong: a quoted field containing a
 * comma ("Director, Product Intelligence", which this data is full of) splits
 * into two, shifting every later column in the preview by one.
 */
export function csvRowCells(row: CsvRow): string[] {
  const { first, last } = splitName(row.name);
  return [
    first,
    last,
    cleanName(row.company),
    cleanName(row.enrichedTitle || row.headline),
    row.enrichedEmail || "",
    row.enrichedPhone || "",
    row.enrichedLinkedinUrl || row.profileUrl || row.salesNavLeadUrl || "",
    row.location || "",
  ];
}

export function buildMasterCsv(rows: CsvRow[]): string {
  const body = rows.map((row) => csvRowCells(row).map(csvEscape).join(","));
  return [CSV_HEADER.join(","), ...body].join("\r\n");
}
