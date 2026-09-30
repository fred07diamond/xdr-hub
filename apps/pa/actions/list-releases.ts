import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { ACTIVE_LABEL } from "../server/core/playbook/store.js";
import { repo } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Playbook releases, newest first, with which one is active. Releases never change; engagements stay pinned to the release they were decided under.",
  schema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args) => {
    const repository = repo();
    const [releases, label] = await Promise.all([
      repository.listReleases(args.limit),
      repository.getLabel(ACTIVE_LABEL),
    ]);
    return {
      activeReleaseId: label?.releaseId ?? null,
      activatedBy: label?.movedBy ?? null,
      activatedAt: label?.movedAt ?? null,
      releases: releases.map((release) => ({
        id: release.id,
        shortId: release.shortId,
        createdAt: release.createdAt,
        notes:
          (release.content as { release_notes?: string }).release_notes ?? "",
        active: release.id === label?.releaseId,
      })),
    };
  },
});
