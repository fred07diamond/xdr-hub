import {
  buildGroundingBlock,
  findMention,
  getCustomerEvidence,
  getPersonaLinkedGroundingDocs,
  getSharedDb,
} from "@xdr-hub/shared/server";

// li-agent's own thin wrapper around the shared Sales Library lookups
// (packages/shared/src/server/sales-library.ts) -- a genuinely new
// capability for this app, not a merge of an existing feature. Mirrors
// prospecting-hub's server/helpers/draft-outreach.ts assembly, minus its
// generate-then-check-then-retry compliance loop: a 200-char connection
// note has far less room for an unauthorized customer mention to hide in,
// so draft-profile.ts only gets a single-pass instruction plus
// unauthorizedCustomerMentioned() to flag (not silently fix) a bad draft.

export interface PersonaGrounding {
  groundingBlock: string;
  customerEvidenceBlock: string | null;
  otherCustomerNames: string[];
}

export async function getPersonaGrounding(
  personaId: string | null,
  personaName: string | null,
): Promise<PersonaGrounding> {
  const sharedDb = getSharedDb();
  const [groundingDocs, { proof: customerEvidence, allCustomerNames }] = await Promise.all([
    getPersonaLinkedGroundingDocs(sharedDb, personaId),
    getCustomerEvidence(sharedDb, personaName),
  ]);

  const groundingBlock = buildGroundingBlock(groundingDocs);
  const customerEvidenceBlock = customerEvidence
    ? `Customer proof point for this persona — you may reference it if it fits naturally in the note, and must NOT name any other customer: ${customerEvidence.customer} — ${customerEvidence.evidence}`
    : null;
  const otherCustomerNames = allCustomerNames.filter(
    (name) => !customerEvidence || name.toLowerCase() !== customerEvidence.customer.toLowerCase(),
  );

  return { groundingBlock, customerEvidenceBlock, otherCustomerNames };
}

/** Case-insensitive check: did the draft name a customer it wasn't authorized to? */
export function unauthorizedCustomerMentioned(text: string, otherCustomerNames: string[]): string | null {
  return findMention(text, otherCustomerNames);
}
