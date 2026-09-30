import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { APPROACHES } from "../server/core/drafting/index.js";
import { messagingGuide } from "../server/core/playbook/messaging.js";
import { activeRelease, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Get the playbook's Messaging section: how every first touch is written (TCQ rubric, voice, choosing questions, the formula for each Contact Sales class, the agency path, and a worked example). Read this before every draft and follow it. It comes from the current playbook, so edits made in the Playbook apply to the next draft. Pass the lead's approach to get only that class's formula plus the shared rules.",
  schema: z.object({
    approach: z
      .enum(APPROACHES)
      .optional()
      .describe("The lead's class, for example standard_content"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const release = await activeRelease(repo());
    return messagingGuide(release, args.approach ?? null);
  },
});
