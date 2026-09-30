import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { activeRelease, isPaAdmin } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "PA Hub operating mode and the current playbook release: shadow mode, release id, and how many playbook values still wait for owner confirmation.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const release = await activeRelease();
    const isAppOwner = await isPaAdmin(ctx?.userEmail ?? null);
    return {
      mode: "shadow" as const,
      viewer: { isAppOwner },
      release: {
        id: release.id,
        shortId: release.short_id,
        pendingConfirmations: release.pending_confirmation.length,
      },
    };
  },
});
