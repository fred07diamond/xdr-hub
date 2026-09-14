import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getLeadScoringSettings } from "../server/helpers/lead-scoring-settings.js";
import {
  MAX_FIT_SCORE,
  SCORE_WEIGHTS,
  VERDICT_THRESHOLDS,
} from "../server/helpers/fit-score.js";

// Readable by every signed-in member: these decide which leads appear in the
// highlighted section, so every user's page depends on them. Only writing is
// admin-gated.
export default defineAction({
  description:
    "Thresholds for the highlighted (hot) leads section, plus the fit-score weights the UI renders breakdown bars against.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async () => {
    const settings = await getLeadScoringSettings();
    return {
      ...settings,
      // Returned so the client never has to hard-code a maximum to draw a bar
      // against. The client mirror in app/lib/fit-score-shared.ts is the
      // fallback for a failed read, not the source of truth.
      weights: SCORE_WEIGHTS,
      maxScore: MAX_FIT_SCORE,
      verdictThresholds: VERDICT_THRESHOLDS,
    };
  },
});
