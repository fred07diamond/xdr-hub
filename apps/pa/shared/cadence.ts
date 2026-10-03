// Follow-up cadences (D101): for each lead route, the follow-ups the agent
// writes after the first touch. Isomorphic: the playbook block validates
// with it, the editor renders from it, and the sweep schedules from it.
import { z } from "zod";

/** The routes that get a cadence, with the plain name the editor shows. */
export const CADENCE_ROUTES = [
  {
    route: "route_to_ae",
    label: "Exceptional, routed to the AE",
    hint: "The AE stays on cc when it is on",
  },
  {
    route: "pa_meeting",
    label: "Standard with potential, the PA takes the call",
    hint: "",
  },
  {
    route: "qualify_first",
    label: "Requires discovery, qualify first",
    hint: "",
  },
  {
    route: "clarify_once",
    label: "One clarification email",
    hint: "Usually off: the clarification email is the only one",
  },
] as const;
export type CadenceRoute = (typeof CADENCE_ROUTES)[number]["route"];
export const CADENCE_ROUTE_IDS = CADENCE_ROUTES.map((item) => item.route);

export const cadenceStepSchema = z.object({
  /** Days after the first touch. */
  day: z.number().int().min(1).max(60),
  /** What this follow-up is for; the agent writes the email from it. */
  purpose: z.string().trim().min(3).max(400),
});
export type CadenceStep = z.infer<typeof cadenceStepSchema>;

export const routeCadenceSchema = z.object({
  enabled: z.boolean(),
  /** Keep the AE on cc (only meaningful when the route loops one in). */
  cc_ae: z.boolean().optional(),
  steps: z.array(cadenceStepSchema).max(10),
});
export type RouteCadence = z.infer<typeof routeCadenceSchema>;

const hm = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM, such as 08:00");

/** Cadence-wide settings (D103): the lead's send window and the caps. */
export const cadenceSettingsSchema = z
  .object({
    /** Follow-ups come due inside this window, in the lead's time zone. */
    window_start: hm,
    window_end: hm,
    /** Follow-ups one rep can send in a rolling 24 hours. */
    daily_cap: z.number().int().min(1).max(500),
    /** Follow-ups to one company in a rolling 24 hours, across its leads. */
    company_daily_cap: z.number().int().min(1).max(20),
  })
  .partial();
export type CadenceSettings = z.infer<typeof cadenceSettingsSchema>;

export const CADENCE_DEFAULTS: Required<CadenceSettings> = {
  window_start: "08:00",
  window_end: "17:00",
  daily_cap: 40,
  company_daily_cap: 1,
};

export function cadenceSettings(
  params: CadenceParams | null | undefined,
): Required<CadenceSettings> {
  return { ...CADENCE_DEFAULTS, ...(params?.settings ?? {}) };
}

export const cadenceParamsSchema = z
  .object({
    settings: cadenceSettingsSchema.optional(),
    route_to_ae: routeCadenceSchema.optional(),
    pa_meeting: routeCadenceSchema.optional(),
    qualify_first: routeCadenceSchema.optional(),
    clarify_once: routeCadenceSchema.optional(),
  })
  .strict();
export type CadenceParams = z.infer<typeof cadenceParamsSchema>;

/** A route's cadence, steps in day order; none when it is off or missing. */
export function cadenceFor(
  params: CadenceParams | null | undefined,
  route: string,
): (RouteCadence & { steps: CadenceStep[] }) | null {
  if (route === "settings") return null;
  const cadence = (params as Record<string, RouteCadence | undefined>)?.[route];
  if (!cadence?.enabled || cadence.steps.length === 0) return null;
  return {
    ...cadence,
    steps: [...cadence.steps].sort((a, b) => a.day - b.day),
  };
}
