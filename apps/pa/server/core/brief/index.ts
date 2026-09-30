// The lead brief (D61): the xDR master instructions' CRM note as data. The
// drafting agent writes it before the draft, from sources only; anything it
// does not know stays unknown. PA shows it and formats the CRM note for the
// rep to paste. PA never writes it to HubSpot.
import { z } from "zod";

export const GATES = [
  "pain",
  "champion",
  "next_step",
  "enterprise_need",
  "metrics",
] as const;

export const GATE_LABELS: Record<(typeof GATES)[number], string> = {
  pain: "Mutually identified pain we can solve",
  champion: "Potential champion identified (or a path to one)",
  next_step: "Tangible next step with a meeting calendared",
  enterprise_need: "Confirmed need for the Enterprise plan (2+ signals)",
  metrics: "Supporting metrics (directional is fine)",
};

const text = (max: number) => z.string().trim().max(max);

export const leadBriefSchema = z.object({
  summary: text(500).describe("Lead summary so far, one or two sentences"),
  persona: z.enum(["design", "eng", "product", "exec", "content", "unknown"]),
  deal_role: z.enum([
    "potential_champion",
    "likely_buyer",
    "path_to_engineering",
    "coach",
    "unknown",
  ]),
  use_case: z.enum([
    "collaborative_build",
    "idea_validation",
    "design_system_adoption",
    "content_cms",
    "unknown",
  ]),
  trigger: text(300).nullable().optional(),
  v2_orientation: text(400)
    .nullable()
    .optional()
    .describe(
      'Building in real code with eng involved, or sandbox prototyping with no eng path, with the evidence. For Content: "Content, not on the code/build spine"',
    ),
  path_to_engineering: text(300).nullable().optional(),
  scope: text(300).nullable().optional(),
  existing_ai_tooling: text(200).nullable().optional(),
  pain_and_impact: text(400).nullable().optional(),
  contact_influence: text(400).nullable().optional(),
  enterprise_signals: z.array(text(120)).max(10).default([]),
  gates: z
    .array(
      z.object({
        gate: z.enum(GATES),
        status: z.enum(["met", "gap", "unknown"]),
        evidence: text(300),
        next_move: text(300).nullable().optional(),
      }),
    )
    .length(5)
    .refine((items) => new Set(items.map((item) => item.gate)).size === 5, {
      message: "List each of the five gates once",
    }),
  agency: z
    .object({
      path: z.enum(["A", "B", "C", "unknown"]),
      end_customer: text(120).nullable().optional(),
      end_customer_headcount: text(60).nullable().optional(),
      end_customer_hq: text(120).nullable().optional(),
    })
    .nullable()
    .optional(),
  gaps_risks: z.array(text(200)).max(8).default([]),
  next_step: text(300),
});
export type LeadBrief = z.infer<typeof leadBriefSchema>;

const PERSONA: Record<LeadBrief["persona"], string> = {
  design: "Design",
  eng: "Eng",
  product: "Product",
  exec: "Exec",
  content: "Content or marketing",
  unknown: "Unknown",
};
const ROLE: Record<LeadBrief["deal_role"], string> = {
  potential_champion: "Potential champion",
  likely_buyer: "Likely buyer",
  path_to_engineering: "Path to engineering",
  coach: "Coach",
  unknown: "Unknown",
};
const USE_CASE: Record<LeadBrief["use_case"], string> = {
  collaborative_build: "Collaborative Build",
  idea_validation: "Idea Validation",
  design_system_adoption: "Design System Adoption",
  content_cms: "Content CMS",
  unknown: "Unknown",
};

export const briefLabels = { PERSONA, ROLE, USE_CASE };

/** The master instructions' CRM note format; fields without values are left out. */
export function crmNote(
  brief: LeadBrief,
  context: { company: string | null; contact: string; source: string },
): string {
  const line = (label: string, value: string | null | undefined) =>
    value && value.trim() ? `${label}: ${value.trim()}` : null;
  const gate = (key: (typeof GATES)[number]) => {
    const item = brief.gates.find((entry) => entry.gate === key);
    if (!item) return null;
    const status =
      item.status === "met" ? "Met" : item.status === "gap" ? "Gap" : "Unknown";
    return `- ${GATE_LABELS[key]}: ${status}. ${item.evidence}${item.next_move ? ` Next: ${item.next_move}` : ""}`;
  };
  return [
    line("Lead summary so far", brief.summary),
    line("Persona", PERSONA[brief.persona]),
    line("Likely deal role", ROLE[brief.deal_role]),
    line("Source", context.source),
    line("Company", context.company),
    line("Contact & Role", context.contact),
    line("Trigger/Signal", brief.trigger),
    line("Use case", USE_CASE[brief.use_case]),
    line("V2 orientation", brief.v2_orientation),
    line("Path to engineering", brief.path_to_engineering),
    line("Scope", brief.scope),
    line("Existing AI tooling", brief.existing_ai_tooling),
    line("Pain & Impact", brief.pain_and_impact),
    line("Contact influence read", brief.contact_influence),
    brief.agency
      ? [
          line("Agency Routing Path", `Path ${brief.agency.path}`),
          line("End Customer", brief.agency.end_customer),
          line("End Customer Headcount", brief.agency.end_customer_headcount),
          line("End Customer HQ", brief.agency.end_customer_hq),
        ]
          .filter(Boolean)
          .join("\n")
      : null,
    brief.enterprise_signals.length
      ? line("Enterprise signals", brief.enterprise_signals.join("; "))
      : null,
    "",
    "Stage 1 Gate Status:",
    ...GATES.map(gate),
    "",
    line("Next step", brief.next_step),
    brief.gaps_risks.length
      ? line("Gaps/Risks", brief.gaps_risks.join("; "))
      : null,
  ]
    .filter((item) => item !== null)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
