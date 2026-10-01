import { z } from "zod";

import {
  CrmNotInThisSliceError,
  LIFECYCLE_ORDER,
  type CrmCompany,
  type CrmContact,
  type CrmDeal,
  type CrmOwner,
  type CrmPort,
  type CrmRef,
  type LifecycleStage,
} from "./port.js";

export const fixtureCaseSchema = z.object({
  id: z.string(),
  submission: z.object({
    email: z.string(),
    name: z.string().optional(),
    company: z.string().optional(),
    country: z.string().optional(),
    message: z.string(),
    /** HubSpot form and contact fields, such as breeze_fit_score. */
    fields: z.record(z.string(), z.string()).optional(),
  }),
  crm: z.object({
    lifecycle: z.string().nullable().optional(),
    contact_owner: z.string().nullable().optional(),
    last_activity_days: z.number().nullable().optional(),
    open_deals: z.number().int().min(0).optional(),
    customer: z.boolean().optional(),
  }),
  expected: z.record(z.string(), z.string()),
});
export type FixtureCase = z.infer<typeof fixtureCaseSchema>;

export const fixtureFileSchema = z.object({
  note: z.string(),
  cases: z.array(fixtureCaseSchema).min(1),
});

const LIFECYCLE_ALIASES: Record<string, LifecycleStage> = {
  marketingqualifiedlead: "mql",
  salesqualifiedlead: "sql",
};

export function canonicalLifecycle(
  raw: string | null | undefined,
): LifecycleStage | null {
  if (!raw) return null;
  const key = raw.trim().toLowerCase();
  if ((LIFECYCLE_ORDER as readonly string[]).includes(key))
    return key as LifecycleStage;
  return LIFECYCLE_ALIASES[key] ?? null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export class FixtureCrmAdapter implements CrmPort {
  readonly system = "fixture" as const;
  private readonly byEmail = new Map<string, FixtureCase>();

  constructor(
    cases: FixtureCase[],
    private readonly now: () => Date,
  ) {
    for (const item of cases) {
      this.byEmail.set(item.submission.email.trim().toLowerCase(), item);
    }
  }

  private owner(email: string | null | undefined): CrmOwner | null {
    if (!email) return null;
    return {
      ref: { system: "fixture", id: `owner:${email}` },
      email,
      name: null,
    };
  }

  private contactFor(item: FixtureCase): CrmContact {
    const fetched = this.now();
    const days = item.crm.last_activity_days;
    return {
      ref: { system: "fixture", id: `contact:${item.id}` },
      email: item.submission.email.trim().toLowerCase(),
      name: item.submission.name ?? null,
      lifecycle: canonicalLifecycle(item.crm.lifecycle),
      lifecycleRaw: item.crm.lifecycle ?? null,
      owner: this.owner(item.crm.contact_owner),
      lastActivityAt:
        typeof days === "number"
          ? new Date(fetched.getTime() - days * DAY_MS).toISOString()
          : null,
      isCustomer: item.crm.customer === true,
      isChurned: false,
      productSignal: null,
      fetchedAt: fetched.toISOString(),
    };
  }

  private caseForRef(ref: CrmRef): FixtureCase {
    const id = ref.id.replace(/^(contact|company):/, "");
    for (const item of this.byEmail.values()) if (item.id === id) return item;
    throw new Error(`Fixture has no record ${ref.id}`);
  }

  async findContactByEmail(email: string) {
    const item = this.byEmail.get(email.trim().toLowerCase());
    return item ? this.contactFor(item) : null;
  }

  async getContact(ref: CrmRef) {
    return this.contactFor(this.caseForRef(ref));
  }

  async getCompanyForContact(ref: CrmRef): Promise<CrmCompany | null> {
    const item = this.caseForRef(ref);
    const email = item.submission.email.toLowerCase();
    return {
      ref: { system: "fixture", id: `company:${item.id}` },
      domain: email.slice(email.lastIndexOf("@") + 1),
      name: null,
      owner: this.owner(item.crm.contact_owner),
      isCustomer: item.crm.customer === true,
      fetchedAt: this.now().toISOString(),
    };
  }

  async listOpenDeals(company: CrmRef): Promise<CrmDeal[]> {
    const item = this.caseForRef(company);
    const count = item.crm.open_deals ?? 0;
    return Array.from({ length: count }, (_, index) => ({
      ref: { system: "fixture" as const, id: `deal:${item.id}:${index + 1}` },
      name: `Open deal ${index + 1}`,
      stage: "open",
      owner: this.owner(item.crm.contact_owner),
      fetchedAt: this.now().toISOString(),
    }));
  }

  async listOwners(): Promise<CrmOwner[]> {
    const emails = new Set<string>();
    for (const item of this.byEmail.values()) {
      if (item.crm.contact_owner) emails.add(item.crm.contact_owner);
    }
    return [...emails].map((email) => this.owner(email) as CrmOwner);
  }

  async logEmail(): Promise<CrmRef> {
    throw new CrmNotInThisSliceError("Logging email to the CRM starts in M2.");
  }

  async proposeWrite(): Promise<string> {
    throw new CrmNotInThisSliceError("CRM write proposals start in M3.");
  }
}
