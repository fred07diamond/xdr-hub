import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getSharedDb } from "@xdr-hub/shared/server";
import { buildPersonaSalesNavSearch } from "../server/helpers/persona-sales-nav-link.js";

// Session/A2A-authenticated sibling of generate-sales-nav-search.ts, for
// callers that already have a real signed-in identity and a known persona id
// (no free-text matching needed) -- specifically prospecting-hub's prospect-
// pull-plan reconcile step (Phase 5 of the alignment roadmap), called via
// @agent-native/core/a2a's invokeAgentAction() when a persona's target is
// still short after pulling from the captured LinkedIn lead pool.
//
// generate-sales-nav-search.ts itself stays requiresAuth: false to keep
// supporting its existing anonymous personal-apiToken callers (the Chrome
// extension, My Accounts) -- flipping that to true would 401 every one of
// those calls before its run() ever executes (confirmed against the
// framework's own auth-gate code), so this is a separate action reusing the
// same underlying title-tier logic (server/helpers/persona-sales-nav-link.ts)
// rather than a change to that action's auth surface.
export default defineAction({
  description:
    "Generate a Sales Navigator search URL for one persona (by id), using that persona's generated briefing -- primary + fallback titles included, 'wrong buyer' avoid-titles excluded. Session/A2A-authenticated only; for the free-text/anonymous-apiToken flow see generate-sales-nav-search.",
  schema: z.object({
    personaId: z.string().min(1),
    companyName: z.string().nullish(),
  }),
  requiresAuth: true,
  readOnly: true,
  publicAgent: { expose: true, readOnly: true, requiresAuth: true },
  http: { method: "GET" },
  run: async ({ personaId, companyName }) => {
    const sharedDb = getSharedDb();
    const result = await buildPersonaSalesNavSearch(sharedDb, { personaId, companyName });
    if (!result) {
      return { error: "That persona doesn't have a generated briefing with titles yet." };
    }
    return result;
  },
});
