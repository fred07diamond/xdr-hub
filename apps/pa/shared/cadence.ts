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

export const cadenceParamsSchema = z
  .object({
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
  const cadence = (params as Record<string, RouteCadence | undefined>)?.[route];
  if (!cadence?.enabled || cadence.steps.length === 0) return null;
  return {
    ...cadence,
    steps: [...cadence.steps].sort((a, b) => a.day - b.day),
  };
}
