import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { wakeInboundAgent } from "../server/lib/live-pipeline.js";
import { now, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "People only. Save the meeting link of the person a lead is routed to (D72), from the lead page. The link is kept on that person, so every lead routed to them uses it and nobody is asked again; their role and pod AE are kept. Drafts are rewritten with the link. Stored in PA only.",
  schema: z.object({
    email: z.string().trim().toLowerCase().email(),
    meetingLink: z
      .string()
      .trim()
      .max(500)
      .url()
      .refine((value) => value.startsWith("https://"), "Use an https link"),
    displayName: z.string().trim().max(120).nullable().optional(),
    role: z.enum(["pa", "ae", "csm"]).nullable().optional(),
  }),
  agentTool: false,
  audit: {
    target: (args: { email: string }) => ({
      type: "pa-person",
      id: args.email,
    }),
    summary: (args: { email: string }) =>
      `Saved the meeting link for ${args.email}`,
  },
  run: async (args, ctx) => {
    const actor = ctx?.userEmail?.toLowerCase();
    if (!actor) fail("Sign in first", { statusCode: 401 });
    if (!(await canEditHandbook(ctx)))
      fail("Saving a meeting link needs a PA role or app owner access.", {
        statusCode: 403,
      });
    const repository = repo();
    const existing = (await repository.listPeople()).find(
      (person) => person.email === args.email,
    );
    const at = now().toISOString();
    const person = await repository.upsertPerson({
      email: args.email,
      displayName: existing?.displayName ?? args.displayName ?? null,
      role: existing?.role ?? args.role ?? null,
      meetingLink: args.meetingLink,
      podAeEmail: existing?.podAeEmail ?? null,
      updatedBy: actor,
      createdAt: existing?.createdAt ?? at,
      updatedAt: at,
    });
    // Drafts written without the link are rewritten with it.
    const agent = await wakeInboundAgent({
      userEmail: actor,
      orgId: ctx?.orgId,
    });
    return { person, agent };
  },
});
