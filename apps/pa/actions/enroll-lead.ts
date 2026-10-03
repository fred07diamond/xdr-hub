import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { repo } from "../server/lib/pa-context.js";
import { EnrollRefused, enrollInSequence } from "../server/lib/sequences.js";

export default defineAction({
  description:
    "People only, never the agent (D105). The lead's owner enrolls it in a sequence after the first touch. For an editable sequence, pass the edited emails; enrolling approves them and each sends on its day from the owner's Gmail. A lead in another sequence moves to this one. Replies, meetings, bounces, and stage changes still unenroll it.",
  schema: z.object({
    engagementId: z.string().min(1),
    sequenceId: z.string().min(1),
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
  agentTool: false,
  mcpTool: false,
  audit: {
    target: (args: { engagementId: string }) => ({
      type: "pa-engagement",
      id: args.engagementId,
    }),
    summary: (args: { engagementId: string; sequenceId: string }) =>
      `Enrolled ${args.engagementId} in sequence ${args.sequenceId}`,
  },
  run: async (args, ctx) => {
    if (ctx?.caller === "tool")
      fail("Only a person can enroll a lead.", { statusCode: 403 });
    const email = ctx?.userEmail?.toLowerCase();
    if (!email) fail("Sign in first", { statusCode: 401 });
    try {
      return await enrollInSequence(repo(), {
        engagementId: args.engagementId,
        sequenceId: args.sequenceId,
        actorEmail: email,
        edits: args.edits,
      });
    } catch (error) {
      if (error instanceof EnrollRefused)
        fail(error.message, { statusCode: 409, errorCode: "enroll_refused" });
      throw error;
    }
  },
});
