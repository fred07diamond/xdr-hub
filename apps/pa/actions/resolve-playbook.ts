import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { entrySummary } from "../server/core/playbook/resolve.js";
import { loadRelease } from "../server/core/playbook/store.js";
import { activeRelease, repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "List the playbook entries in the release pinned to an engagement, with owners, versions, and which values still need owner confirmation. Rules are evaluated in code; cite entry ids, never reinterpret a rule.",
  schema: z.object({ engagementId: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const repository = repo();
    const engagement = await repository.getEngagement(args.engagementId);
    if (!engagement) fail("Engagement not found", { statusCode: 404 });
    const active = await activeRelease(repository);
    // Validated load: the pinned release the engagement was decided under.
    const release = await loadRelease(repository, engagement.playbookReleaseId);
    if (!release)
      fail("The pinned playbook release is not registered", {
        statusCode: 409,
      });
    return {
      release: {
        id: release.id,
        shortId: release.short_id,
        isCurrent: release.id === active.id,
        activeShortId: active.short_id,
        notes: release.release_notes,
      },
      entries: release.entries.map((entry) => ({
        ...entrySummary(entry),
        needsConfirmation: release.pending_confirmation.some(
          (item) => item.entry_id === entry.id,
        ),
      })),
      pendingConfirmations: release.pending_confirmation,
    };
  },
});
