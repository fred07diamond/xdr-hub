import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { resolveOwner } from "../server/helpers/resolve-owner.js";
import { resolveConnectButtonIndex } from "../server/helpers/connect-button-resolver.js";

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
    return resolveConnectButtonIndex(args.profileName, args.candidates);
  },
});
