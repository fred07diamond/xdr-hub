// SPEC section 10: canonical types only; adapters translate provider shapes.

export type CrmSystem = "hubspot" | "fixture";

export interface CrmRef {
  system: CrmSystem;
  id: string;
}

export const LIFECYCLE_ORDER = [
  "subscriber",
  "lead",
  "mql",
  "ql",
  "sal",
  "sql",
  "opportunity",
  "customer",
  "evangelist",
] as const;
export type LifecycleStage = (typeof LIFECYCLE_ORDER)[number];

export function isSalOrLater(stage: LifecycleStage | null): boolean {
  if (!stage) return false;
  return LIFECYCLE_ORDER.indexOf(stage) >= LIFECYCLE_ORDER.indexOf("sal");
}

export interface CrmOwner {
  ref: CrmRef;
  email: string;
  name: string | null;
}

export interface CrmContact {
  ref: CrmRef;
  email: string;
  name: string | null;
  lifecycle: LifecycleStage | null;
  lifecycleRaw: string | null;
  owner: CrmOwner | null;
  lastActivityAt: string | null;
  isCustomer: boolean;
  isChurned: boolean;
  productSignal: string | null;
  fetchedAt: string;
}

export interface CrmCompany {
  ref: CrmRef;
  domain: string | null;
  name: string | null;
  owner: CrmOwner | null;
  isCustomer: boolean;
  fetchedAt: string;
}

export interface CrmDeal {
  ref: CrmRef;
  name: string;
  stage: string;
  owner: CrmOwner | null;
  fetchedAt: string;
}

export interface LogEmailInput {
  contact: CrmRef;
  ownerRef: CrmRef;
  subject: string;
  text: string;
  sentAt: string;
}

export interface CrmChange {
  target: CrmRef;
  field: string;
  from: unknown;
  to: unknown;
  reason: string;
}

export interface CrmPort {
  readonly system: CrmSystem;
  findContactByEmail(email: string): Promise<CrmContact | null>;
  getContact(ref: CrmRef): Promise<CrmContact>;
  getCompanyForContact(ref: CrmRef): Promise<CrmCompany | null>;
  listOpenDeals(company: CrmRef): Promise<CrmDeal[]>;
  listOwners(): Promise<CrmOwner[]>;
  /** M2: sent emails are logged after human approval. */
  logEmail(input: LogEmailInput, idempotencyKey: string): Promise<CrmRef>;
  /** M3: write proposals need owner approval first. */
  proposeWrite(change: CrmChange): Promise<string>;
}

export class CrmNotInThisSliceError extends Error {}

export interface CrmSnapshot {
  source: CrmSystem;
  fetchedAt: string;
  contact: CrmContact | null;
  company: CrmCompany | null;
  openDeals: CrmDeal[];
}

export async function takeCrmSnapshot(
  crm: CrmPort,
  email: string,
  fetchedAt: string,
): Promise<CrmSnapshot> {
  const contact = await crm.findContactByEmail(email);
  if (!contact) {
    return {
      source: crm.system,
      fetchedAt,
      contact: null,
      company: null,
      openDeals: [],
    };
  }
  const company = await crm.getCompanyForContact(contact.ref);
  const openDeals = company ? await crm.listOpenDeals(company.ref) : [];
  return { source: crm.system, fetchedAt, contact, company, openDeals };
}
