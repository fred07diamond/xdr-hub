import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { desc, eq } from "@agent-native/core/db/schema";
import { getOutreachVoiceGuidelines } from "@xdr-hub/shared/server";
import { getDb } from "../db/index.js";
import { contacts, libraryDocs } from "../db/schema.js";

// Grounds a per-contact outreach draft in the same Sales Library content
// already uploaded, per Fred's explicit "use the documents as much as
// possible" direction — never inventing a fact about the contact or their
// company beyond what's already present in the input (see systemPrompt
// below, mirroring score-contact.ts's own grounding-instruction convention).

const NAME = "Customer Evidence Quick Reference";
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

export interface DraftOutreachResult {
  emailSubject: string;
  emailBody: string;
  linkedinMessage: string;
}

export interface DraftOutreachContact {
  name: string;
  title: string | null;
  company: string | null;
  scoreReasoning: string | null;
}

/**
 * Parses the "Customer Evidence Quick Reference" doc's markdown table into
 * every row's {customer, evidence} — a simple line-by-line `|`-split parse,
 * no markdown table library needed, this doc's shape is fixed and small.
 * Shared by `selectCustomerEvidenceProof` (which picks the one authorized
 * row) and `getCustomerEvidence` (which also needs the full customer-name
 * list, to build the "unauthorized names" compliance guard in
 * `draftOutreach`).
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
 * lead for `personaName` — per the doc's own explicit "one proof per
 * call... lead with X, Y, or Z by persona" sentence. Any persona not named
 * in that lead sentence (Exec, CMS Outreach, or any future persona) gets
 * `null` — a "Use For" mention elsewhere in the table (e.g. WebMD's
 * "Eng/Exec persona") is explicitly NOT a primary assignment, only the row
 * whose customer is named in the doc's own "lead with" sentence counts.
 */
export function selectCustomerEvidenceProof(
  docContent: string,
  personaName: string | null,
): CustomerEvidenceProof | null {
  if (!personaName) return null;

  const leadMatch = /lead with\s+(.+?)\s+by persona/i.exec(docContent);
  if (!leadMatch) return null;
  // "Intuit, BlueMarvel, or H&R Block" -> ["Intuit", "BlueMarvel", "H&R Block"]
  const leadCustomers = leadMatch[1]
    .split(/,|\bor\b/i)
    .map((s) => s.trim())
    .filter(Boolean);
  if (leadCustomers.length === 0) return null;

  const rows = parseCustomerEvidenceRows(docContent);

  for (const leadCustomer of leadCustomers) {
    const row = rows.find((r) => r.customer.toLowerCase() === leadCustomer.toLowerCase());
    if (!row) continue;
    // The row's own "Use For" text names the persona it leads for as the
    // first "<Persona> persona" mention (e.g. "Design persona, scale and
    // design-org adoption..."). Only a match against THIS contact's persona
    // authorizes using this row.
    const personaMatch = /^([A-Za-z/()]+)\s+persona/i.exec(row.evidence.split("(")[1] ?? "");
    if (personaMatch && personaMatch[1].toLowerCase() === personaName.toLowerCase()) {
      return { customer: row.customer, evidence: row.evidence };
    }
  }
  return null;
}

/**
 * Query + sort + slice heuristic for persona-linked grounding docs — mirrors
 * run-sourcing-rule-pipeline.ts's exact `linkedDocs`/`groundingDocs` shape,
 * simplified to the persona-only half (no ICP) since outreach drafting has
 * no ICP concept: docs whose `linkedPersonaId` matches the contact's
 * persona, preferring `category === "persona_messaging"` (the most relevant
 * category for outreach copy specifically), up to 2, excerpted to 3000
 * chars each.
 */
async function getPersonaLinkedGroundingDocs(personaId: string | null): Promise<GroundingDoc[]> {
  if (!personaId) return [];
  const db = getDb();
  const linkedDocs = await db
    .select({ id: libraryDocs.id, name: libraryDocs.name, category: libraryDocs.category, content: libraryDocs.content })
    .from(libraryDocs)
    .where(eq(libraryDocs.linkedPersonaId, personaId))
    .orderBy(desc(libraryDocs.createdAt));

  return [...linkedDocs]
    .sort((a, b) => {
      const aPref = PREFERRED_GROUNDING_CATEGORIES.has(a.category) ? 0 : 1;
      const bPref = PREFERRED_GROUNDING_CATEGORIES.has(b.category) ? 0 : 1;
      return aPref - bPref;
    })
    .slice(0, MAX_GROUNDING_DOCS);
}

/**
 * Looked up by exact `name` match — it's a shared cross-persona reference
 * doc (`linkedPersonaId` is NULL), not linked to any one persona. Also
 * returns every customer name in the table (not just the authorized one) so
 * `draftOutreach`'s post-generation compliance guard can check the model's
 * output never names one of the OTHER, unauthorized customers.
 */
async function getCustomerEvidence(
  personaName: string | null,
): Promise<{ proof: CustomerEvidenceProof | null; allCustomerNames: string[] }> {
  const db = getDb();
  const rows = await db
    .select({ content: libraryDocs.content })
    .from(libraryDocs)
    .where(eq(libraryDocs.name, NAME))
    .limit(1);
  const doc = rows[0];
  if (!doc) return { proof: null, allCustomerNames: [] };
  const proof = selectCustomerEvidenceProof(doc.content, personaName);
  const allCustomerNames = parseCustomerEvidenceRows(doc.content).map((r) => r.customer);
  return { proof, allCustomerNames };
}

/**
 * Case-insensitive substring search for the first `names` entry that
 * appears anywhere in `text` — these are proper nouns (Intuit, BlueMarvel,
 * H&R Block, Frete, EagleEye, WebMD, Rakuten, Conservice), so a plain
 * substring match is sufficient; collision risk with ordinary prose is low.
 */
function findMention(text: string, names: string[]): string | null {
  const lower = text.toLowerCase();
  return names.find((name) => lower.includes(name.toLowerCase())) ?? null;
}

function parseDraftResponse(rawText: string): DraftOutreachResult {
  const raw = rawText.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw);
  } catch {
    const g = (re: RegExp) => re.exec(raw)?.[1]?.trim() ?? null;
    parsed = {
      emailSubject: g(/"emailSubject"\s*:\s*"([^"\\]*)"/),
      emailBody: g(/"emailBody"\s*:\s*"([^"\\]*)"/),
      linkedinMessage: g(/"linkedinMessage"\s*:\s*"([^"\\]*)"/),
    };
    if (!parsed.emailSubject && !parsed.emailBody && !parsed.linkedinMessage) {
      throw new Error(`Unparseable draft response: ${raw.slice(0, 200)}`);
    }
  }

  return {
    emailSubject: typeof parsed.emailSubject === "string" ? parsed.emailSubject : "",
    emailBody: typeof parsed.emailBody === "string" ? parsed.emailBody : "",
    linkedinMessage: typeof parsed.linkedinMessage === "string" ? parsed.linkedinMessage : "",
  };
}

/**
 * One `completeText()` call (plus, only when the compliance guard below
 * trips, a single corrective retry): drafts a personalized cold email
 * (subject + body) and a separate, shorter LinkedIn connection note,
 * grounded ONLY in the supplied persona-linked Library doc excerpts, the
 * single authorized Customer Evidence proof point (if any), and the
 * contact's own fields. JSON-primary output, parsed via the same two-tier
 * strict-then-regex-fallback shape as
 * apps/li-agent/server/helpers/draft-profile.ts (more resilient to
 * truncated/malformed model output than a strict-JSON-only parse) — but,
 * like scoreContactAgainstPersonas, THROWS on a genuinely unparseable
 * response rather than silently returning empty-string junk; the caller
 * (generate-contact-draft.ts / bulk-generate-drafts.ts) is what catches
 * this per-contact.
 *
 * Post-generation compliance guard: the "one proof per call" rule is a
 * content-accuracy constraint — an unauthorized customer name leaking into
 * real outreach copy is a reputational problem, not a cosmetic one — so it
 * is NOT enforced by prompt wording alone (verified during initial
 * development: a softer prompt sometimes just omitted the proof point).
 * After parsing the model's response, this checks the combined
 * subject+body+LinkedIn text for any customer name from the Customer
 * Evidence table OTHER than the one (if any) authorized for this persona:
 *   - Unauthorized customer mentioned -> genuine content-safety violation.
 *     Retries the completeText() call once with an explicit correction
 *     naming the violation; if the retry STILL contains an unauthorized
 *     mention, throws (mirroring the "genuinely unparseable" throw
 *     convention above, just for "genuinely non-compliant") so the
 *     caller's existing per-contact try/catch absorbs it rather than a bad
 *     draft ever reaching persistence.
 *   - Authorized proof point supplied but omitted entirely from the draft
 *     -> lower severity (this is the failure mode observed during prompt
 *     tuning: a weaker prompt sometimes left the proof out). This is not a
 *     factual-accuracy problem — the draft still only ever states facts
 *     present in the input, it just under-uses the available evidence —
 *     so it gets the SAME one corrective retry to improve quality, but
 *     does NOT throw if still omitted afterward: an under-grounded but
 *     otherwise-safe draft is fine to persist, unlike a wrong-customer one.
 */
export async function draftOutreach(options: {
  contact: DraftOutreachContact;
  personaName: string | null;
  groundingDocs: GroundingDoc[];
  customerEvidence: CustomerEvidenceProof | null;
  otherCustomerNames: string[];
  userEmail: string;
  orgId?: string | null;
}): Promise<DraftOutreachResult> {
  const { contact, personaName, groundingDocs, customerEvidence, otherCustomerNames, userEmail, orgId } = options;

  const groundingBlock =
    groundingDocs.length > 0
      ? groundingDocs
          .map((d) => `[${d.category}] ${d.name}\n${d.content.slice(0, GROUNDING_DOC_EXCERPT_LENGTH)}`)
          .join("\n\n---\n\n")
      : "No persona-specific messaging docs are linked yet.";

  const evidenceBlock = customerEvidence
    ? `Customer proof point — you MUST reference this specific customer and result by name somewhere in the email body (one sentence is enough), and you must NOT mention any other customer by name: ${customerEvidence.customer} — ${customerEvidence.evidence}`
    : "No customer proof point is authorized for this persona — do not name any specific customer anywhere in the email or LinkedIn note.";

  const contactBlock = [
    `Name: ${contact.name}`,
    contact.title ? `Title: ${contact.title}` : null,
    contact.company ? `Company: ${contact.company}` : null,
    personaName ? `Matched persona: ${personaName}` : "Matched persona: none yet",
    contact.scoreReasoning ? `Prior fit-scoring notes: ${contact.scoreReasoning}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Shared workspace-wide voice/tone guidelines (also used by LinkedIn
  // Agent's own connection-note drafting) — see outreach-voice.ts. Keeps
  // messaging consistent across apps without merging either app's own
  // grounding data or generation logic.
  const voiceGuidelines = await getOutreachVoiceGuidelines(userEmail, orgId);

  const systemPrompt =
    "You are a sales development rep drafting personalized outbound outreach for a single contact.\n\n" +
    `Persona-linked messaging context:\n${groundingBlock}\n\n` +
    `${evidenceBlock}\n\n` +
    `Contact:\n${contactBlock}\n\n` +
    `Voice and tone guidelines (apply to both the email and the LinkedIn note):\n${voiceGuidelines}\n\n` +
    "Draft a personalized cold email (subject + body) AND a separate, SHORTER LinkedIn connection note. " +
    "Ground everything ONLY in the persona/messaging context and the contact's own fields supplied above — " +
    "never invent a fact about the contact or their company that isn't already present in this input " +
    "(no fabricated recent news, funding, headcount, or personal details). The LinkedIn note must be genuine, " +
    "brief (under 300 characters), and reference at most the contact's role/company — not the full pitch.\n\n" +
    'Reply with valid JSON only: { "emailSubject": "<subject line>", "emailBody": "<2-4 short paragraphs, plain text, no markdown>", "linkedinMessage": "<connection note, under 300 characters>" }';

  const input = `Draft outreach for ${contact.name}${contact.title ? `, ${contact.title}` : ""}${contact.company ? ` at ${contact.company}` : ""}.`;

  const callModel = (userInput: string) =>
    runWithRequestContext({ userEmail, orgId: orgId ?? undefined }, () =>
      completeText({
        systemPrompt,
        input: userInput,
        // Draft prose (subject + multi-paragraph body + LinkedIn note) is
        // longer than a JSON score object — score-contact.ts bumped its own
        // maxOutputTokens to 800 after a live-confirmed mid-JSON truncation
        // on a much shorter payload. 1200 gives comparable headroom for
        // this longer expected output plus the same unpredictable
        // internal-reasoning token spend.
        maxOutputTokens: 1200,
      }),
    );

  const combinedText = (d: DraftOutreachResult) => `${d.emailSubject} ${d.emailBody} ${d.linkedinMessage}`;

  const result = await callModel(input);
  let draft = parseDraftResponse(result.text);

  const unauthorized = findMention(combinedText(draft), otherCustomerNames);
  const omittedAuthorized =
    !!customerEvidence && !combinedText(draft).toLowerCase().includes(customerEvidence.customer.toLowerCase());

  if (unauthorized || omittedAuthorized) {
    const correctionNote = unauthorized
      ? `CORRECTION NEEDED: your previous draft incorrectly named "${unauthorized}", a customer that is NOT authorized for this persona. Regenerate the draft. ${
          customerEvidence
            ? `Use ONLY "${customerEvidence.customer}" as the customer proof point.`
            : "Do not name any customer at all."
        } Do not mention "${unauthorized}" or any other unauthorized customer.`
      : `CORRECTION NEEDED: your previous draft did not mention the authorized customer proof point at all. Regenerate the draft and make sure the email body references "${customerEvidence!.customer}" by name.`;

    const retryResult = await callModel(`${input}\n\n${correctionNote}`);
    const retryDraft = parseDraftResponse(retryResult.text);
    const retryUnauthorized = findMention(combinedText(retryDraft), otherCustomerNames);

    if (retryUnauthorized) {
      // A genuine content-safety violation that survived a corrective
      // retry — refuse to return (and therefore persist) this draft, per
      // the same "throw on genuine failure" discipline as the unparseable-
      // response case above.
      throw new Error(
        `Draft mentioned unauthorized customer "${retryUnauthorized}" even after a correction retry — refusing to persist unsafe outreach copy.`,
      );
    }

    // Omission (unlike a wrong-customer mention) isn't a factual-accuracy
    // problem — accept the retry's result even if it still omits the proof
    // point, rather than failing the whole generation over a missed
    // opportunity to cite a stat.
    draft = retryDraft;
  }

  return draft;
}

/**
 * Orchestrates the full "generate + persist" flow for one already-loaded
 * contact row — shared by generate-contact-draft.ts (single) and
 * bulk-generate-drafts.ts (loop), so neither duplicates the grounding-query
 * + persist logic. Resolves the contact's persona name (if any — a contact
 * with no assigned persona yet still gets a best-effort draft, per the
 * app's existing "not yet scored/matched" convention), assembles grounding
 * context, calls draftOutreach(), and persists the 4 draft columns.
 */
export async function generateAndPersistDraft(options: {
  contact: {
    id: string;
    name: string;
    title: string | null;
    company: string | null;
    scoreReasoning: string | null;
    personaId: string | null;
  };
  personaName: string | null;
  userEmail: string;
  orgId?: string | null;
}): Promise<DraftOutreachResult & { draftGeneratedAt: string }> {
  const { contact, personaName, userEmail, orgId } = options;
  const db = getDb();

  const [groundingDocs, { proof: customerEvidence, allCustomerNames }] = await Promise.all([
    getPersonaLinkedGroundingDocs(contact.personaId),
    getCustomerEvidence(personaName),
  ]);

  const otherCustomerNames = allCustomerNames.filter(
    (name) => !customerEvidence || name.toLowerCase() !== customerEvidence.customer.toLowerCase(),
  );

  const draft = await draftOutreach({
    contact: {
      name: contact.name,
      title: contact.title,
      company: contact.company,
      scoreReasoning: contact.scoreReasoning,
    },
    personaName,
    groundingDocs,
    customerEvidence,
    otherCustomerNames,
    userEmail,
    orgId,
  });

  const draftGeneratedAt = new Date().toISOString();
  await db
    .update(contacts)
    .set({
      draftEmailSubject: draft.emailSubject,
      draftEmailBody: draft.emailBody,
      draftLinkedinMessage: draft.linkedinMessage,
      draftGeneratedAt,
    })
    .where(eq(contacts.id, contact.id));

  return { ...draft, draftGeneratedAt };
}
