import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { routeForEngagement } from "../server/core/lead-route/engagement.js";
import { leadOwnerEmail } from "../server/core/outreach/delivery.js";
import { activeRelease, repo } from "../server/lib/pa-context.js";
import { ensureSequences, previewEnrollment } from "../server/lib/sequences.js";

export default defineAction({
  description:
    "People only (D105). How a sequence would run for one lead: each step's day and date and, for an editable sequence, the email filled in for this lead with any problems. Also the sequences to choose from, the one recommended for the lead's route, and why the viewer cannot enroll, if they cannot.",
  schema: z.object({
    engagementId: z.string().min(1),
    sequenceId: z.string().min(1).optional(),
    edits: z
      .record(
        z.string(),
        z.object({
          subject: z.string().optional(),
          body: z.string().optional(),
        }),
      )
      .optional(),
  }),
  readOnly: true,
  agentTool: false,
  run: async (args, ctx) => {
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Lead not found", { statusCode: 404 });
    const sequences = (await ensureSequences(repository)).filter(
      (item) => !item.archived,
    );
    const route = await routeForEngagement(
      repository,
      await activeRelease(repository),
      engagement,
    );
    const recommended =
      sequences.find((item) => item.recommendedFor.includes(route.route)) ??
      null;
    const chosen =
      sequences.find((item) => item.id === args.sequenceId) ??
      recommended ??
      sequences[0] ??
      null;
    const preview = chosen
      ? await previewEnrollment(
          repository,
          engagement,
          chosen,
          args.edits ?? {},
        )
      : {
          steps: [],
          blocker: "No sequences yet. Create one on the Sequencing page.",
        };
    const owner = await leadOwnerEmail(repository, engagement);
    const me = ctx?.userEmail?.toLowerCase() ?? null;
    return {
      route: route.route,
      routeLabel: route.label,
      sequences: sequences.map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        description: item.description,
        steps: item.steps.length,
        days: Math.max(...item.steps.map((step) => step.day)),
        recommended: item.id === recommended?.id,
      })),
      sequenceId: chosen?.id ?? null,
      kind: chosen?.kind ?? null,
      steps: preview.steps,
      blocker:
        preview.blocker ??
        (owner && me !== owner
          ? `Only ${owner}, the lead's owner, can enroll it. The emails go from their Gmail.`
          : null),
    };
  },
});
