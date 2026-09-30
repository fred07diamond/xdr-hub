// CRM field mapping (D48): typed canonical fields, the portal schema shape, type
// compatibility, and a deterministic scorer that proposes a property for each
// unmapped field. Isomorphic: the editor and the server checks use the same code.

export type CrmObject = "contacts" | "companies" | "deals";

/** A property definition as PA stores it: names and types only, never record data. */
export interface PortalProperty {
  name: string;
  label: string;
  type: string;
  fieldType: string;
  groupName: string | null;
  description: string | null;
  options: { label: string; value: string }[];
  hubspotDefined: boolean;
  calculated: boolean;
  readOnlyValue: boolean;
  referencedObjectType: string | null;
  hidden: boolean;
}

export interface PortalSchema {
  fetchedAt: string;
  objects: Partial<Record<CrmObject, PortalProperty[]>>;
}

export type Expects =
  | "owner"
  | "datetime"
  | "enumeration"
  | "bool"
  | "number"
  | "text"
  | "any"
  | "lifecycle_option";

export interface CanonicalField {
  key: string;
  label: string;
  /** The path in the HubSpot mapping config, or null when HubSpot needs no mapping. */
  mapping: string | null;
  object: CrmObject | null;
  expects: Expects;
  meaning: string;
}

/**
 * The fields PA's rules read (SPEC 10), with what each HubSpot property must
 * look like. `mapping: null` means a standard HubSpot object or association.
 */
export const CANONICAL_FIELDS: readonly CanonicalField[] = [
  {
    key: "contact.lifecycle",
    label: "contact lifecycle stage",
    mapping: "contact.lifecycle_stage",
    object: "contacts",
    expects: "enumeration",
    meaning: "Where the contact is in the funnel: lead, QL, SAL, customer.",
  },
  {
    key: "contact.sal_value",
    label: "internal value of the SAL stage",
    mapping: "lifecycle_values.sal",
    object: "contacts",
    expects: "lifecycle_option",
    meaning: "Which lifecycle option means SAL in this portal.",
  },
  {
    key: "contact.owner",
    label: "contact owner",
    mapping: "contact.owner",
    object: "contacts",
    expects: "owner",
    meaning: "The rep who owns the contact.",
  },
  {
    key: "contact.last_activity",
    label: "contact last activity date",
    mapping: "contact.last_activity",
    object: "contacts",
    expects: "datetime",
    meaning:
      "When anyone on our side last touched the contact; decides whether an SAL is stale.",
  },
  {
    key: "contact.product_signal",
    label: "Active in Builder signal",
    mapping: "contact.product_signal",
    object: "contacts",
    expects: "any",
    meaning: "Product activity shown on the scorecard.",
  },
  {
    key: "contact.is_customer",
    label: "contact customer flag",
    mapping: null,
    object: null,
    expects: "any",
    meaning: "Read from the lifecycle stage.",
  },
  {
    key: "company.owner",
    label: "company owner",
    mapping: "company.owner",
    object: "companies",
    expects: "owner",
    meaning: "The rep who owns the account; makes a lead owned.",
  },
  {
    key: "company.is_customer",
    label: "company customer flag",
    mapping: null,
    object: null,
    expects: "any",
    meaning: "Read from the company lifecycle stage.",
  },
  {
    key: "company.name",
    label: "company name",
    mapping: null,
    object: null,
    expects: "any",
    meaning: "Standard company name.",
  },
  {
    key: "deal.open",
    label: "open deals on the company",
    mapping: null,
    object: null,
    expects: "any",
    meaning: "Standard deal associations.",
  },
  {
    key: "deal.owner",
    label: "deal owner",
    mapping: null,
    object: null,
    expects: "any",
    meaning: "Standard deal owner.",
  },
];

export function canonicalField(key: string) {
  return CANONICAL_FIELDS.find((field) => field.key === key) ?? null;
}

export function mappingValue(
  mapping: Record<string, unknown>,
  path: string,
): unknown {
  let current: unknown = mapping;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function setMappingValue(
  mapping: Record<string, unknown>,
  path: string,
  value: unknown,
): Record<string, unknown> {
  const next = structuredClone(mapping);
  const parts = path.split(".");
  let current = next as Record<string, unknown>;
  for (const part of parts.slice(0, -1)) {
    if (!current[part] || typeof current[part] !== "object") current[part] = {};
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
  return next;
}

export const isUnset = (value: unknown) =>
  value === undefined || value === null || value === "" || value === "TODO";

/** Whether a property can hold a canonical field. null means compatible. */
export function incompatibility(
  field: CanonicalField,
  property: PortalProperty,
): string | null {
  switch (field.expects) {
    case "owner":
      return property.referencedObjectType === "OWNER" ||
        property.name.endsWith("owner_id")
        ? null
        : `${property.name} is not an owner property`;
    case "datetime":
      return property.type === "datetime" || property.type === "date"
        ? null
        : `${property.name} is a ${property.type}, not a date`;
    case "enumeration":
      return property.type === "enumeration"
        ? null
        : `${property.name} is a ${property.type}, not a picklist`;
    case "bool":
      return property.type === "bool" ||
        property.fieldType === "booleancheckbox"
        ? null
        : `${property.name} is not a yes-or-no property`;
    case "number":
      return property.type === "number"
        ? null
        : `${property.name} is a ${property.type}, not a number`;
    default:
      return null;
  }
}

const words = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .split(" ")
    .filter(
      (word) =>
        word.length > 1 && !["the", "of", "a", "in", "is", "hs"].includes(word),
    );

/** 0 to 1: how well a property's name and label match a field's label. */
export function matchScore(
  field: CanonicalField,
  property: PortalProperty,
): number {
  if (incompatibility(field, property)) return 0;
  const target = new Set(
    words(field.label.replace(/^(contact|company|deal)\s+/, "")),
  );
  if (target.size === 0) return 0;
  const candidate = new Set([
    ...words(property.name.replace(/_/g, " ")),
    ...words(property.label),
  ]);
  let hits = 0;
  for (const word of target)
    if (
      candidate.has(word) ||
      [...candidate].some((c) => c.startsWith(word) || word.startsWith(c))
    )
      hits += 1;
  let score = hits / target.size;
  if (property.hubspotDefined) score += 0.05; // prefer the standard property on a tie
  if (property.readOnlyValue && field.expects !== "datetime") score -= 0.1;
  return Math.max(0, Math.min(1, score));
}

export interface MappingSuggestion {
  field: string;
  property: string;
  label: string;
  score: number;
}

/** A proposal per unmapped, mappable field. Never applied without a person. */
export function suggestMappings(
  mapping: Record<string, unknown>,
  portal: PortalSchema,
): MappingSuggestion[] {
  const out: MappingSuggestion[] = [];
  for (const field of CANONICAL_FIELDS) {
    if (!field.mapping || !field.object || field.expects === "lifecycle_option")
      continue;
    if (!isUnset(mappingValue(mapping, field.mapping))) continue;
    const ranked = (portal.objects[field.object] ?? [])
      .filter((property) => !property.hidden)
      .map((property) => ({ property, score: matchScore(field, property) }))
      .filter((item) => item.score >= 0.5)
      .sort((a, b) => b.score - a.score);
    if (ranked[0])
      out.push({
        field: field.key,
        property: ranked[0].property.name,
        label: ranked[0].property.label,
        score: Number(ranked[0].score.toFixed(2)),
      });
  }
  return out;
}

export interface MappingProblem {
  field: string;
  message: string;
}

/** Problems with a mapping against the live portal schema. */
export function mappingProblems(
  mapping: Record<string, unknown>,
  portal: PortalSchema,
): MappingProblem[] {
  const problems: MappingProblem[] = [];
  for (const field of CANONICAL_FIELDS) {
    if (!field.mapping || !field.object) continue;
    const value = mappingValue(mapping, field.mapping);
    if (isUnset(value)) continue;
    const properties = portal.objects[field.object];
    if (!properties) continue;
    if (field.expects === "lifecycle_option") {
      const lifecycleName = mappingValue(mapping, "contact.lifecycle_stage");
      const lifecycle = properties.find(
        (property) => property.name === lifecycleName,
      );
      if (
        lifecycle &&
        !lifecycle.options.some((option) => option.value === value)
      ) {
        problems.push({
          field: field.key,
          message: `${String(value)} is not an option of ${lifecycle.name}`,
        });
      }
      continue;
    }
    const property = properties.find((item) => item.name === value);
    if (!property) {
      problems.push({
        field: field.key,
        message: `${String(value)} does not exist on ${field.object} in the portal`,
      });
      continue;
    }
    const wrong = incompatibility(field, property);
    if (wrong) problems.push({ field: field.key, message: wrong });
  }
  return problems;
}
