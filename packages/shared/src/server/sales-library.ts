import { desc, eq } from "@agent-native/core/db/schema";
import type { getSharedDb } from "./db/index.js";
import { sharedLibraryDocs } from "./db/index.js";

type SharedDb = ReturnType<typeof getSharedDb>;

// Shared Sales Library grounding logic, extracted from prospecting-hub's
// server/helpers/draft-outreach.ts so li-agent's drafting can ground
// connection notes in the same persona-linked reference docs -- a real new
// capability for li-agent, not a merge of two overlapping features (it had
// no reference-doc concept of its own before this). Each app keeps its own
// generation logic (prompt wording, compliance guards, output shape) --
// only the "which docs/proof point apply to this persona" lookup is shared,
// same "share the input, not the generation" philosophy as
// getOutreachVoiceGuidelines (outreach-voice.ts).

const CUSTOMER_EVIDENCE_DOC_NAME = "Customer Evidence Quick Reference";
const PREFERRED_GROUNDING_CATEGORIES = new Set(["persona_messaging"]);
const MAX_GROUNDING_DOCS = 2;
const GROUNDING_DOC_EXCERPT_LENGTH = 3000;

export interface GroundingDoc {
  id: string;
  name: string;
  category: string;
  content: string;
}

export interface CustomerEvidenceProof {
  customer: string;
  evidence: string;
}

/**
 * Parses the "Customer Evidence Quick Reference" doc's markdown table into
 * every row's {customer, evidence} -- a simple line-by-line `|`-split parse,
 * no markdown table library needed, this doc's shape is fixed and small.
 */
function parseCustomerEvidenceRows(docContent: string): CustomerEvidenceProof[] {
  const rows: CustomerEvidenceProof[] = [];
  for (const line of docContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || /^\|\s*-+/.test(trimmed)) continue;
    const cells = trimmed.split("|").map((c) => c.trim()).filter((_, i, arr) => i > 0 && i < arr.length - 1);
    if (cells.length < 3) continue;
    const [customer, evidence, useFor] = cells;
    if (customer === "Customer") continue; // header row
    rows.push({ customer, evidence: `${evidence} (${useFor})` });
  }
  return rows;
}

/**
 * Returns the SINGLE proof point the doc itself authorizes as the primary
 * lead for `personaName` -- per the doc's own explicit "one proof per
 * call... lead with X, Y, or Z by persona" sentence. Any persona not named
 * in that lead sentence gets `null`.
 */
export function selectCustomerEvidenceProof(
  docContent: string,
  personaName: string | null,
): CustomerEvidenceProof | null {
  if (!personaName) return null;

  const leadMatch = /lead with\s+(.+?)\s+by persona/i.exec(docContent);
  if (!leadMatch) return null;
  const leadCustomers = leadMatch[1]
    .split(/,|\bor\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (leadCustomers.length === 0) return null;

  const rows = parseCustomerEvidenceRows(docContent);

  for (const leadCustomer of leadCustomers) {
    const row = rows.find((r) => r.customer.toLowerCase() === leadCustomer.toLowerCase());
    if (!row) continue;
    const personaMatch = /^([A-Za-z/()]+)\s+persona/i.exec(row.evidence.split("(")[1] ?? "");
    if (personaMatch && personaMatch[1].toLowerCase() === personaName.toLowerCase()) {
      return { customer: row.customer, evidence: row.evidence };
    }
  }
  return null;
}

/**
 * Persona-linked grounding docs: docs whose `linkedPersonaId` matches the
 * given persona, preferring `category === "persona_messaging"`, up to 2,
 * excerpted to 3000 chars each.
 */
export async function getPersonaLinkedGroundingDocs(
  db: SharedDb,
  personaId: string | null,
): Promise<GroundingDoc[]> {
  if (!personaId) return [];
  const linkedDocs = await db
    .select({ id: sharedLibraryDocs.id, name: sharedLibraryDocs.name, category: sharedLibraryDocs.category, content: sharedLibraryDocs.content })
    .from(sharedLibraryDocs)
    .where(eq(sharedLibraryDocs.linkedPersonaId, personaId))
    .orderBy(desc(sharedLibraryDocs.createdAt));

  return [...linkedDocs]
    .sort((a, b) => {
      const aPref = PREFERRED_GROUNDING_CATEGORIES.has(a.category) ? 0 : 1;
      const bPref = PREFERRED_GROUNDING_CATEGORIES.has(b.category) ? 0 : 1;
      return aPref - bPref;
    })
    .slice(0, MAX_GROUNDING_DOCS);
}

/**
 * Looked up by exact `name` match -- a shared cross-persona reference doc
 * (`linkedPersonaId` is NULL), not linked to any one persona. Also returns
 * every customer name in the table (not just the authorized one) so a
 * caller's compliance guard can check generated output never names an
 * unauthorized customer.
 */
export async function getCustomerEvidence(
  db: SharedDb,
  personaName: string | null,
): Promise<{ proof: CustomerEvidenceProof | null; allCustomerNames: string[] }> {
  const rows = await db
    .select({ content: sharedLibraryDocs.content })
    .from(sharedLibraryDocs)
    .where(eq(sharedLibraryDocs.name, CUSTOMER_EVIDENCE_DOC_NAME))
    .limit(1);
  const doc = rows[0];
  if (!doc) return { proof: null, allCustomerNames: [] };
  const proof = selectCustomerEvidenceProof(doc.content, personaName);
  const allCustomerNames = parseCustomerEvidenceRows(doc.content).map((r) => r.customer);
  return { proof, allCustomerNames };
}

/** Builds the "Persona-linked messaging context" prompt block from grounding docs, or an honest "none linked yet" fallback. */
export function buildGroundingBlock(groundingDocs: GroundingDoc[]): string {
  return groundingDocs.length > 0
    ? groundingDocs
        .map((d) => `[${d.category}] ${d.name}\n${d.content.slice(0, GROUNDING_DOC_EXCERPT_LENGTH)}`)
        .join("\n\n---\n\n")
    : "No persona-specific messaging docs are linked yet.";
}

/**
 * Case-insensitive substring search for the first `names` entry that
 * appears anywhere in `text` -- these are proper nouns, so a plain
 * substring match is sufficient.
 */
export function findMention(text: string, names: string[]): string | null {
  const lower = text.toLowerCase();
  return names.find((name) => lower.includes(name.toLowerCase())) ?? null;
}
