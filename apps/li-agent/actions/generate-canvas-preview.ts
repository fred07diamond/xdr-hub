import { defineAction } from "@agent-native/core";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { buildCanvasContext } from "../server/helpers/build-canvas-context.js";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";

export default defineAction({
  description:
    "Generate a sample LinkedIn connection note using the active messaging canvas guidelines. Returns the note directly for display in the preview panel.",
  schema: z.object({
    canvasId: z.string().describe("Messaging canvas ID to use for context"),
  }),
  http: { method: "POST" },
  run: async (args) => {
    const db = getDb();
    const canvasContext = await buildCanvasContext(args.canvasId, db);

    const systemPrompt =
      "You are a LinkedIn outreach assistant. Generate a sample connection note (150–250 characters) for a fictional prospect: Alex Chen, VP of Sales at a mid-size B2B SaaS company. Write ONLY the note itself — no preamble, no quotes, no labels.";

    const input = canvasContext
      ? `Apply these messaging guidelines:\n${canvasContext}`
      : "Use a neutral, professional tone.";

    const ownerCtx = await getOwnerCtx();
    const callCompleteText = () =>
      completeText({
        systemPrompt,
        input,
        maxOutputTokens: 300,
      });

    const result = ownerCtx
      ? await runWithRequestContext(ownerCtx, callCompleteText)
      : await callCompleteText();

    return { preview: result.text.trim() };
  },
});
