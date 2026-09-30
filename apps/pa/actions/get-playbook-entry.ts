import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { findEntry, pendingFor } from "../server/core/playbook/resolve.js";
import { loadRelease } from "../server/core/playbook/store.js";
import { activeRelease, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Get one playbook entry (body, params, rationale, sources) from the release pinned to an engagement, with any values still awaiting owner confirmation.",
  schema: z.object({
    engagementId: z.string().min(1),
    entryId: z
      .string()
      .min(1)
      .describe("Entry id such as msg.first_touch.structure"),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Engagement not found", { statusCode: 404 });
    await activeRelease(repository);
    // Validated load: the pinned release the engagement was decided under.
    const release = await loadRelease(repository, engagement.playbookReleaseId);
    if (!release)
      fail("The pinned playbook release is not registered", {
        statusCode: 409,
      });
    const entry = findEntry(release, args.entryId);
    if (!entry)
      fail(`Release ${release.short_id} has no entry ${args.entryId}`, {
        statusCode: 404,
      });
    return {
      releaseId: release.id,
      releaseShortId: release.short_id,
      entry,
      pendingConfirmations: pendingFor(release, entry.id),
    };
  },
});
