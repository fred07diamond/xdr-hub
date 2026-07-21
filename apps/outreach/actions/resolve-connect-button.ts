import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { getOwnerCtx } from "../server/helpers/get-owner-ctx.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

export default defineAction({
  description: "Given a list of interactive Connect-related elements found on a LinkedIn profile page, returns the index of the one that belongs to the profile being viewed (not a sidebar recommendation).",
  schema: z.object({
    profileName: z.string(),
    candidates: z.array(
      z.object({
        index: z.number(),
        tag: z.string(),
        text: z.string(),
        ariaLabel: z.string().nullable(),
        contextText: z.string(),
      })
    ),
    apiToken: z.string().nullish(),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: true, requiresAuth: false },
  run: async (args, ctx) => {
    await resolveOwner(args.apiToken, ctx);

    if (args.candidates.length === 0) return { ok: false, error: "No candidates provided." };
    if (args.candidates.length === 1) return { ok: true, index: 0 };

    const ownerCtx = await getOwnerCtx();

    const candidateList = args.candidates
      .map((c) => `${c.index}: tag=${c.tag} ariaLabel="${c.ariaLabel ?? ""}" surroundingText="${c.contextText}"`)
      .join("\n");

    const call = () =>
      completeText({
        systemPrompt:
          "You are given a list of interactive Connect elements found on a LinkedIn profile page and the name of the person whose profile is being viewed. " +
          "Some elements belong to the main profile card (correct). Others belong to sidebar recommendations (wrong). " +
          "Reply with ONLY the integer index of the main profile Connect button.",
        input: `Profile being viewed: ${args.profileName}\n\nCandidates:\n${candidateList}\n\nWhich index is the Connect button for ${args.profileName}?`,
        maxOutputTokens: 5,
      });

    const result = ownerCtx ? await runWithRequestContext(ownerCtx, call) : await call();

    const index = parseInt(result.text.trim(), 10);
    if (isNaN(index) || index < 0 || index >= args.candidates.length) {
      return { ok: false, error: `Agent returned unexpected value: "${result.text.trim()}"` };
    }

    return { ok: true, index };
  },
});
