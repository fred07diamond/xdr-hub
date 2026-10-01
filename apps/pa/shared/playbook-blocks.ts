// The playbook's block types (D46): like CMS component types. Types live in
// code; instances are playbook entries whose params are the block's data.
// Isomorphic: the server validates and checks with it, the builder renders
// palettes and editors from it, and the agent reads it as vocabulary.
import { z } from "zod";

import { PRECHECK_OUTCOMES } from "../server/core/objects/index.js";

export const SECTIONS = [
  {
    id: "definitions",
    label: "Definitions",
    hint: "What the team means by QL, SAL, recycle, and disqualify",
  },
  {
    id: "rules_of_engagement",
    label: "Rules of engagement",
    hint: "Who we engage, and what a submission triggers first",
  },
  {
    id: "ownership",
    label: "Ownership",
    hint: "Which PA owns a lead: HubSpot's assignment, in what order",
  },
  {
    id: "routing",
    label: "Routing",
    hint: "After triage: whether the AE or the PA takes the meeting",
  },
  { id: "clocks", label: "Clocks", hint: "How fast each step must happen" },
  {
    id: "qualification",
    label: "Qualification",
    hint: "Bars and thresholds for a verdict",
  },
  {
    id: "messaging",
    label: "Messaging",
    hint: "How first touches are written",
  },
  { id: "knowledge", label: "Knowledge", hint: "Facts a draft may cite" },
  { id: "crm", label: "CRM", hint: "Which CRM, and how its fields map to PA" },
  {
    id: "views",
    label: "Views",
    hint: "How the board and records are laid out",
  },
] as const;
export type SectionId = (typeof SECTIONS)[number]["id"];
export const SECTION_IDS = SECTIONS.map((section) => section.id) as [
  SectionId,
  ...SectionId[],
];

/** Where a block's data lives: a playbook entry, or a release config value. */
export type BlockStorage =
  | {
      kind: "entry";
      entryType: "definition" | "rule" | "message_rule" | "knowledge" | "view";
      idPrefix: string;
    }
  | {
      kind: "config";
      target: "config.routing_pool" | "config.hubspot_mapping";
    };

export interface BlockType {
  type: string;
  label: string;
  /** A @tabler/icons-react component name. */
  icon: string;
  description: string;
  sections: readonly SectionId[];
  defaultOwnerTeam: "pa_team" | "revops" | "both";
  storage: BlockStorage;
  /** Validates the block's data (the entry's params, or the config value). */
  schema: z.ZodType;
  /** Whether the entry needs a body (guidance text). */
  body: "required" | "optional" | "none";
  /** Data for a newly dropped block. */
  empty: () => Record<string, unknown>;
  /**
   * What code must do to act on a new instance of this type. Becomes the
   * build brief in the app owner's feature suggestion (D46).
   */
  brief: string;
  /** Singletons appear once per playbook (the CRM mapping, the pool). */
  singleton?: boolean;
}

const isoCountry = z
  .string()
  .regex(/^[A-Z]{2}$/, "Use two-letter ISO country codes, such as CU");
const emailOrTodo = z
  .string()
  .refine(
    (value) => value === "TODO" || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    "An email address, or TODO",
  );
const outcome = z.enum(PRECHECK_OUTCOMES);

export const BLOCK_TYPES: readonly BlockType[] = [
  {
    type: "definition",
    label: "Definition",
    icon: "IconBook",
    description: "A term the team uses, in plain words.",
    sections: ["definitions"],
    defaultOwnerTeam: "revops",
    storage: { kind: "entry", entryType: "definition", idPrefix: "def" },
    schema: z.object({}).loose(),
    body: "required",
    empty: () => ({}),
    brief:
      "Definitions are read by people and the agent; no code change is needed unless a rule should test this definition.",
  },
  {
    type: "country_list",
    label: "Country list",
    icon: "IconWorld",
    description:
      "A list of countries a rule applies to, such as the countries we do not engage.",
    sections: ["rules_of_engagement", "ownership", "qualification"],
    defaultOwnerTeam: "revops",
    storage: { kind: "entry", entryType: "rule", idPrefix: "rule" },
    schema: z.object({ countries: z.array(isoCountry) }).loose(),
    body: "optional",
    empty: () => ({ countries: [] }),
    brief:
      "Compare the submission's country (ISO 3166-1 alpha-2, uppercased) with params.countries in the pipeline step this rule belongs to, decide the outcome when it matches, cite the entry on the receipt, and add unit tests for a match, a miss, and an unknown country.",
  },
  {
    type: "precheck_outcomes",
    label: "Pre-check outcomes",
    icon: "IconFilter",
    description:
      "Signals checked in order, each with what happens when it matches.",
    sections: ["rules_of_engagement"],
    defaultOwnerTeam: "revops",
    storage: { kind: "entry", entryType: "rule", idPrefix: "rule" },
    schema: z.record(z.string(), z.union([outcome, z.string()])),
    body: "optional",
    empty: () => ({}),
    brief:
      "Each new signal needs a rule function in server/core/precheck that decides whether the signal matched from the CRM snapshot and the assessment, plus its evidence on the receipt and tests.",
  },
  {
    type: "routing_order",
    label: "Routing order",
    icon: "IconArrowsSort",
    description:
      "Ownership steps in order; the first that finds an owner wins.",
    sections: ["ownership"],
    defaultOwnerTeam: "revops",
    storage: { kind: "entry", entryType: "rule", idPrefix: "rule" },
    schema: z
      .object({
        order: z.array(z.string()).min(1),
        agency_partner_rep: emailOrTodo.optional(),
      })
      .loose(),
    body: "optional",
    empty: () => ({ order: ["existing_active_owner", "round_robin"] }),
    brief:
      "Each new step needs a routing function in server/core/routing that returns an owner or passes, with the reason on the receipt and tests for both.",
  },
  {
    type: "threshold",
    label: "Threshold",
    icon: "IconGauge",
    description:
      "A number a rule compares against, such as days before an SAL counts as stale.",
    sections: ["ownership", "qualification", "rules_of_engagement"],
    defaultOwnerTeam: "revops",
    storage: { kind: "entry", entryType: "rule", idPrefix: "rule" },
    schema: z.record(z.string(), z.union([z.number(), z.string()])),
    body: "optional",
    empty: () => ({ value: 0 }),
    brief:
      "Read the number from params in the step that uses it, compare it with the value it gates, cite the entry and the compared value on the receipt, and test both sides of the threshold.",
  },
  {
    type: "clock",
    label: "Clock",
    icon: "IconClock",
    description:
      "How long a step may take, when to remind, and who hears about a breach.",
    sections: ["clocks"],
    defaultOwnerTeam: "revops",
    storage: { kind: "entry", entryType: "rule", idPrefix: "rule" },
    schema: z
      .object({
        minutes: z.number().int().positive().optional(),
        hours: z.number().positive().optional(),
        reminder_at_fraction: z.number().gt(0).lt(1).optional(),
        breach_notify: z.string().optional(),
        clock: z.string().optional(),
      })
      .loose()
      .refine(
        (value) => value.minutes !== undefined || value.hours !== undefined,
        "A clock needs minutes or hours",
      ),
    body: "optional",
    empty: () => ({ hours: 24 }),
    brief:
      "Start the clock at the event it measures, compute its due time in the owner's working hours (server/core/clocks), show it on the board, and let the sweep remind and escalate; test due times across working hours and weekends.",
  },
  {
    type: "message_rule",
    label: "Message rule",
    icon: "IconMail",
    description:
      "How first touches are written: structure, length, words to avoid.",
    sections: ["messaging"],
    defaultOwnerTeam: "pa_team",
    storage: { kind: "entry", entryType: "message_rule", idPrefix: "msg" },
    schema: z
      .object({
        min_words: z.number().int().positive().optional(),
        target_words: z.number().int().positive().optional(),
        max_words: z.number().int().positive().optional(),
        no_colons: z.boolean().optional(),
        banned_terms: z.array(z.string()).optional(),
        banned_chars: z.array(z.string()).optional(),
        banned_phrases: z.array(z.string()).optional(),
      })
      .loose(),
    body: "required",
    empty: () => ({}),
    brief:
      "The drafting agent reads message rules; add their limits to the draft lint (SPEC 5.5) so a draft that breaks them is flagged, and add eval cases.",
  },
  {
    type: "knowledge",
    label: "Knowledge article",
    icon: "IconBulb",
    description: "A sourced fact a draft may cite, with a review-by date.",
    sections: ["knowledge"],
    defaultOwnerTeam: "pa_team",
    storage: { kind: "entry", entryType: "knowledge", idPrefix: "kb" },
    schema: z.object({}).loose(),
    body: "optional",
    empty: () => ({}),
    brief:
      "Knowledge is read by the drafting agent through get-playbook-entry; no code change is needed.",
  },
  {
    type: "class_routes",
    label: "Routing by class",
    icon: "IconArrowsExchange",
    description:
      "For each Contact Sales class, who takes the meeting: the AE, the PA, or qualify first.",
    sections: ["routing"],
    defaultOwnerTeam: "both",
    storage: { kind: "entry", entryType: "rule", idPrefix: "rule" },
    schema: z.record(z.string(), z.string()),
    body: "optional",
    empty: () => ({}),
    brief:
      "Read by server/core/lead-route; a new route needs a branch in leadRouteFor, its email rule in the Messaging section, and tests.",
    singleton: true,
  },
  {
    type: "person_pool",
    label: "Round-robin pool",
    icon: "IconUsers",
    description: "The people new, unowned leads are shared between.",
    sections: ["ownership"],
    defaultOwnerTeam: "pa_team",
    storage: { kind: "config", target: "config.routing_pool" },
    schema: z.object({ pool: z.array(emailOrTodo) }),
    body: "none",
    empty: () => ({ pool: [] }),
    brief:
      "The pool is read by routing's round robin; no code change is needed.",
    singleton: true,
  },
  {
    type: "crm_system",
    label: "CRM system",
    icon: "IconDatabase",
    description: "Which CRM PA reads from.",
    sections: ["crm"],
    defaultOwnerTeam: "revops",
    storage: { kind: "entry", entryType: "rule", idPrefix: "rule" },
    schema: z.object({ system: z.enum(["hubspot", "salesforce"]) }).loose(),
    body: "optional",
    empty: () => ({ system: "hubspot" }),
    brief:
      "A CRM needs an adapter behind the CRM port (server/core/crm): contact by email, company, open deals, owners, with contract tests against recorded fixtures.",
    singleton: true,
  },
  {
    type: "crm_mapping",
    label: "CRM field mapping",
    icon: "IconArrowsExchange",
    description: "Which CRM property holds each field PA reads.",
    sections: ["crm"],
    defaultOwnerTeam: "revops",
    storage: { kind: "config", target: "config.hubspot_mapping" },
    schema: z.record(z.string(), z.unknown()),
    body: "none",
    empty: () => ({}),
    brief:
      "The HubSpot adapter reads property names from this mapping; a new canonical field also needs adding to CANONICAL_CRM_FIELDS and the adapter.",
    singleton: true,
  },
  {
    type: "custom_rule",
    label: "Custom rule",
    icon: "IconPuzzle",
    description:
      "A rule in plain words, with the CRM fields it needs. The app owner gets a build request.",
    sections: [
      "rules_of_engagement",
      "ownership",
      "routing",
      "clocks",
      "qualification",
    ],
    defaultOwnerTeam: "revops",
    storage: { kind: "entry", entryType: "rule", idPrefix: "rule" },
    schema: z.record(z.string(), z.unknown()),
    body: "required",
    empty: () => ({ note: "Describe the rule in the body" }),
    brief:
      "A custom rule has no evaluator by design. Turn the body into a typed block or a rule function: decide its inputs (the declared CRM fields), where in the pipeline it runs, its outcome, and its receipt, then add tests.",
  },
  {
    type: "view",
    label: "View",
    icon: "IconLayoutBoard",
    description:
      "How the board or a record is laid out: columns, tabs, default filters.",
    sections: ["views"],
    defaultOwnerTeam: "pa_team",
    storage: { kind: "entry", entryType: "view", idPrefix: "view" },
    schema: z
      .object({
        columns: z.array(z.string()).optional(),
        tabs: z.array(z.string()).optional(),
      })
      .loose(),
    body: "optional",
    empty: () => ({ columns: [] }),
    brief:
      "The board does not render view entries yet: read the active view entries in list-inbound and the board, from a fixed registry of known columns and tabs.",
  },
];

export const BLOCK_TYPE_IDS = BLOCK_TYPES.map((block) => block.type) as [
  string,
  ...string[],
];

export function blockType(type: string | undefined): BlockType | null {
  return BLOCK_TYPES.find((block) => block.type === type) ?? null;
}

/** A slug for a new block's entry id: lowercase, words joined with underscores. */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

/** The entry id for a new block: prefix, section, and a unique slug. */
export function newEntryId(
  type: BlockType,
  section: SectionId,
  name: string,
  taken: ReadonlySet<string>,
): string {
  if (type.storage.kind !== "entry")
    throw new Error(`${type.label} is not stored as an entry`);
  const base = `${type.storage.idPrefix}.${section}.${slugify(name) || "block"}`;
  let id = base;
  for (let n = 2; taken.has(id); n += 1) id = `${base}_${n}`;
  return id;
}

/** Plain names for the seeded blocks; anything else is named from its id. */
const ENTRY_TITLES: Record<string, string> = {
  "def.ql": "Qualified lead (QL)",
  "def.sal": "Sales accepted lead (SAL)",
  "def.recycle": "Recycle",
  "def.disqualify": "Disqualify",
  "rule.precheck.outcomes": "Pre-check outcomes",
  "rule.precheck.restricted_countries": "Restricted countries",
  "rule.routing.order": "Ownership order",
  "rule.routing.by_class": "Routing by class",
  "rule.routing.sal_stale_days": "When a SAL goes stale",
  "rule.sla.first_touch": "First touch SLA",
  "rule.sla.decision": "Decision deadline",
  "rule.enterprise.bar": "Enterprise bar",
  "rule.qualify.tiers": "Exceptional or requires discovery",
  "msg.first_touch.structure": "First touch structure (TCQ)",
  "msg.first_touch.voice": "Voice",
  "msg.first_touch.questions": "Choosing questions",
  "msg.first_touch.hq_content": "Exceptional, Content",
  "msg.first_touch.standard_content": "Requires discovery, Content",
  "msg.first_touch.content_price_check": "Content price check",
  "msg.first_touch.hq_code": "Exceptional, Code",
  "msg.first_touch.standard_code": "Requires discovery, Code",
  "msg.agency.first_touch": "Agency",
  "msg.first_touch.clarify": "One clarification email",
  "msg.first_touch.example": "Example, bad and better",
  "kb.partner_program": "Partner program",
  "kb.trial_path_partner_led": "Partner-led trial path",
  "rule.crm.system": "CRM system",
  "config.routing_pool": "Round-robin pool",
  "config.hubspot_mapping": "CRM field mapping",
};

export function entryTitle(id: string): string {
  const known = ENTRY_TITLES[id];
  if (known) return known;
  const last = id.split(".").pop() ?? id;
  const words = last.replace(/[_-]+/g, " ").trim();
  return words ? words[0].toUpperCase() + words.slice(1) : id;
}
