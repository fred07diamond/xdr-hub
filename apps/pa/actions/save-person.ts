import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { now, repo } from "../server/lib/pa-context.js";

const email = z.string().trim().toLowerCase().email();

export default defineAction({
  description:
    "People only. Save someone leads are routed to (D66): their role (PA, Enterprise AE in the round robin, Commercial AE, CSM) and meeting link. Stored in PA only; nothing is written to HubSpot.",
  schema: z.object({
    email,
    displayName: z.string().trim().max(120).nullable().optional(),
    role: z
      .enum(["pa", "ae", "commercial_ae", "partnerships", "csm"])
      .nullable(),
    meetingLink: z
      .string()
      .trim()
      .max(500)
      .url()
      .refine((value) => value.startsWith("https://"), "Use an https link")
      .nullable(),
    podAeEmail: email.nullable().optional(),
  }),
  agentTool: false,
  audit: {
    target: (args: { email: string }) => ({
      type: "pa-person",
      id: args.email,
    }),
    summary: (args: { email: string }) =>
      `Saved routing details for ${args.email}`,
  },
  run: async (args, ctx) => {
    const actor = ctx?.userEmail?.toLowerCase();
    if (!actor) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Editing people needs a PA role or app owner access.", {
        statusCode: 403,
      });
    if (args.podAeEmail && args.podAeEmail === args.email)
      fail("A PA cannot be their own pod AE", { statusCode: 400 });
    const at = now().toISOString();
    const person = await repo().upsertPerson({
      email: args.email,
      displayName: args.displayName ?? null,
      role: args.role,
      meetingLink: args.meetingLink,
      podAeEmail: args.role === "pa" ? (args.podAeEmail ?? null) : null,
      updatedBy: actor,
      createdAt: at,
      updatedAt: at,
    });
    return { person };
  },
});
