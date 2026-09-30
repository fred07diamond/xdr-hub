// The HubSpot adapter behind the CRM port (SPEC 10). Reads only: contacts,
// their company, open deals, and owners. Writes throw until M2 and M3, and
// only then through approval. Portal shapes are translated here and nowhere
// else, using the RevOps-owned mapping (config.hubspot_mapping).
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

/** A GET or POST against api.hubapi.com, path first. Injected so tests never call HubSpot. */
export type HubSpotFetch = (
  path: string,
  init?: { method?: string; body?: string },
) => Promise<unknown>;

export interface HubSpotMapping {
  contact?: {
    lifecycle_stage?: string;
    owner?: string;
    last_activity?: string;
  };
  company?: { owner?: string };
}

/**
 * This portal's lifecycle stage is a custom enum (RAW, MEL, QL, SAL, S0, S1,
 * Closed, Recycle, Excluded, Disqualified). Labels map to PA's canonical
 * stages; stages PA has no equivalent for stay null and keep their raw label.
 */
const LABEL_TO_STAGE: Record<string, LifecycleStage> = {
  raw: "lead",
  lead: "lead",
  subscriber: "subscriber",
  mel: "mql",
  mql: "mql",
  marketingqualifiedlead: "mql",
  ql: "ql",
  sal: "sal",
  s0: "sql",
  sql: "sql",
  salesqualifiedlead: "sql",
  s1: "opportunity",
  opportunity: "opportunity",
  customer: "customer",
  evangelist: "evangelist",
};

export function canonicalStage(label: string | null): LifecycleStage | null {
  if (!label) return null;
  const key = label
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "");
  const stage = LABEL_TO_STAGE[key];
  return stage && LIFECYCLE_ORDER.includes(stage) ? stage : null;
}

interface HubSpotObject {
  id: string;
  properties: Record<string, string | null | undefined>;
}

/**
 * An owner assigned within this window before the submission, or after it,
 * is the CRM's intake assignment for this lead. The submission time HubSpot
 * records runs a few minutes behind the form, so the window is generous.
 */
export const INTAKE_ASSIGNMENT_WINDOW_MS = 30 * 60_000;

export function isIntakeAssignment(
  assignedAt: string | null,
  asOf: string | undefined,
): boolean {
  if (!assignedAt || !asOf) return false;
  const assigned = Date.parse(assignedAt);
  const submitted = Date.parse(asOf);
  if (Number.isNaN(assigned) || Number.isNaN(submitted)) return false;
  return assigned >= submitted - INTAKE_ASSIGNMENT_WINDOW_MS;
}

const str = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export class HubSpotCrmAdapter implements CrmPort {
  readonly system = "hubspot" as const;
  private owners = new Map<string, CrmOwner | null>();
  private lifecycleLabels: Map<string, string> | null = null;

  constructor(
    private readonly fetch: HubSpotFetch,
    private readonly mapping: HubSpotMapping,
    private readonly now: () => Date,
  ) {}

  private field(value: string | undefined, fallback: string) {
    return value && value !== "TODO" ? value : fallback;
  }

  private get contactFields() {
    return {
      lifecycle: this.field(
        this.mapping.contact?.lifecycle_stage,
        "lifecyclestage",
      ),
      owner: this.field(this.mapping.contact?.owner, "hubspot_owner_id"),
      lastActivity: this.field(
        this.mapping.contact?.last_activity,
        "notes_last_updated",
      ),
    };
  }

  /** Internal option values to labels, read once per adapter from the property definition. */
  private async lifecycleLabel(value: string | null): Promise<string | null> {
    if (!value) return null;
    if (!this.lifecycleLabels) {
      this.lifecycleLabels = new Map();
      try {
        const property = (await this.fetch(
          `/crm/v3/properties/contacts/${encodeURIComponent(this.contactFields.lifecycle)}`,
        )) as { options?: Array<{ value: string; label: string }> };
        for (const option of property.options ?? [])
          this.lifecycleLabels.set(option.value, option.label);
      } catch {
        // Without the definition the raw value still reads; labels are a nicety.
      }
    }
    return this.lifecycleLabels.get(value) ?? value;
  }

  private async owner(id: string | null): Promise<CrmOwner | null> {
    if (!id) return null;
    if (this.owners.has(id)) return this.owners.get(id) ?? null;
    let owner: CrmOwner | null = null;
    try {
      const raw = (await this.fetch(
        `/crm/v3/owners/${encodeURIComponent(id)}`,
      )) as {
        id?: string | number;
        email?: string;
        firstName?: string;
        lastName?: string;
        archived?: boolean;
      };
      if (raw?.email) {
        const name = [raw.firstName, raw.lastName].filter(Boolean).join(" ");
        owner = {
          ref: { system: "hubspot", id: String(raw.id ?? id) },
          email: raw.email.toLowerCase(),
          name: name || null,
        };
      }
    } catch {
      owner = null;
    }
    this.owners.set(id, owner);
    return owner;
  }

  private async toContact(
    raw: HubSpotObject,
    asOf?: string,
  ): Promise<CrmContact> {
    const fields = this.contactFields;
    const props = raw.properties;
    const lifecycleRaw = await this.lifecycleLabel(
      str(props[fields.lifecycle]),
    );
    const lifecycle = canonicalStage(lifecycleRaw);
    const name = [str(props.firstname), str(props.lastname)]
      .filter(Boolean)
      .join(" ");
    const owner = await this.owner(str(props[fields.owner]));
    const intake = isIntakeAssignment(
      str(props.hubspot_owner_assigneddate),
      asOf,
    );
    return {
      ref: { system: "hubspot", id: raw.id },
      email: (str(props.email) ?? "").toLowerCase(),
      name: name || null,
      lifecycle,
      lifecycleRaw,
      owner: intake ? null : owner,
      assignedOwner: intake ? owner : null,
      lastActivityAt: str(props[fields.lastActivity]),
      isCustomer: lifecycle === "customer",
      isChurned: false,
      productSignal: str(props.last_active_in_builder),
      fetchedAt: this.now().toISOString(),
    };
  }

  private contactProperties() {
    const fields = this.contactFields;
    return [
      "email",
      "firstname",
      "lastname",
      fields.lifecycle,
      fields.owner,
      fields.lastActivity,
      "last_active_in_builder",
      "hubspot_owner_assigneddate",
    ];
  }

  async findContactByEmail(
    email: string,
    asOf?: string,
  ): Promise<CrmContact | null> {
    const result = (await this.fetch("/crm/v3/objects/contacts/search", {
      method: "POST",
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [
              { propertyName: "email", operator: "EQ", value: email.trim() },
            ],
          },
        ],
        properties: this.contactProperties(),
        limit: 1,
      }),
    })) as { results?: HubSpotObject[] };
    const found = result.results?.[0];
    return found ? this.toContact(found, asOf) : null;
  }

  async getContact(ref: CrmRef): Promise<CrmContact> {
    const raw = (await this.fetch(
      `/crm/v3/objects/contacts/${encodeURIComponent(ref.id)}?properties=${this.contactProperties().join(",")}`,
    )) as HubSpotObject;
    return this.toContact(raw);
  }

  private async associated(from: string, id: string, to: string) {
    const result = (await this.fetch(
      `/crm/v4/objects/${from}/${encodeURIComponent(id)}/associations/${to}?limit=25`,
    )) as { results?: Array<{ toObjectId: string | number }> };
    return (result.results ?? []).map((item) => String(item.toObjectId));
  }

  async getCompanyForContact(
    ref: CrmRef,
    asOf?: string,
  ): Promise<CrmCompany | null> {
    const [companyId] = await this.associated("contacts", ref.id, "companies");
    if (!companyId) return null;
    const ownerField = this.field(
      this.mapping.company?.owner,
      "hubspot_owner_id",
    );
    const raw = (await this.fetch(
      `/crm/v3/objects/companies/${encodeURIComponent(companyId)}?properties=name,domain,lifecyclestage,hubspot_owner_assigneddate,${ownerField}`,
    )) as HubSpotObject;
    const lifecycle = canonicalStage(
      await this.lifecycleLabel(str(raw.properties.lifecyclestage)),
    );
    const owner = await this.owner(str(raw.properties[ownerField]));
    const intake = isIntakeAssignment(
      str(raw.properties.hubspot_owner_assigneddate),
      asOf,
    );
    return {
      ref: { system: "hubspot", id: raw.id },
      domain: str(raw.properties.domain),
      name: str(raw.properties.name),
      owner: intake ? null : owner,
      assignedOwner: intake ? owner : null,
      isCustomer: lifecycle === "customer",
      fetchedAt: this.now().toISOString(),
    };
  }

  async listOpenDeals(company: CrmRef): Promise<CrmDeal[]> {
    const ids = (await this.associated("companies", company.id, "deals")).slice(
      0,
      10,
    );
    const deals: CrmDeal[] = [];
    for (const id of ids) {
      const raw = (await this.fetch(
        `/crm/v3/objects/deals/${encodeURIComponent(id)}?properties=dealname,dealstage,hubspot_owner_id,hs_is_closed`,
      )) as HubSpotObject;
      if (str(raw.properties.hs_is_closed) === "true") continue;
      deals.push({
        ref: { system: "hubspot", id: raw.id },
        name: str(raw.properties.dealname) ?? "Deal",
        stage: str(raw.properties.dealstage) ?? "unknown",
        owner: await this.owner(str(raw.properties.hubspot_owner_id)),
        fetchedAt: this.now().toISOString(),
      });
    }
    return deals;
  }

  async listOwners(): Promise<CrmOwner[]> {
    const result = (await this.fetch("/crm/v3/owners?limit=100")) as {
      results?: Array<{
        id: string | number;
        email?: string;
        firstName?: string;
        lastName?: string;
      }>;
    };
    return (result.results ?? [])
      .filter((item) => item.email)
      .map((item) => ({
        ref: { system: "hubspot" as const, id: String(item.id) },
        email: String(item.email).toLowerCase(),
        name: [item.firstName, item.lastName].filter(Boolean).join(" ") || null,
      }));
  }

  async logEmail(): Promise<CrmRef> {
    throw new CrmNotInThisSliceError("Logging email to HubSpot arrives in M2");
  }

  async proposeWrite(): Promise<string> {
    throw new CrmNotInThisSliceError("CRM write proposals arrive in M3");
  }
}
