// CSV builder shared by the Prospects page's "Export CSV" button
// (app/routes/_index.tsx). Same column shape as the extension's per-list
// Apollo export (buildApolloCsv in extension/panel.js), so a rep gets one
// consistent format whether exporting a single list or everything at once.
interface CsvRow {
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

function csvEscape(value: string | number | null | undefined): string {
  const s = value == null ? "" : String(value);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function splitName(name: string | null): { first: string; last: string } {
  if (!name) return { first: "", last: "" };
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: parts[0], last: "" };
  return { first: parts[0], last: parts.slice(1).join(" ") };
}

export function buildMasterCsv(rows: CsvRow[]): string {
  const header = ["First Name", "Last Name", "Company", "Title", "Email", "Phone", "LinkedIn Url", "Location"];
  const body = rows.map((row) => {
    const { first, last } = splitName(row.name);
    return [
      first,
      last,
      row.company || "",
      row.enrichedTitle || row.headline || "",
      row.enrichedEmail || "",
      row.enrichedPhone || "",
      row.enrichedLinkedinUrl || row.profileUrl || row.salesNavLeadUrl || "",
      row.location || "",
    ].map(csvEscape).join(",");
  });
  return [header.join(","), ...body].join("\r\n");
}
