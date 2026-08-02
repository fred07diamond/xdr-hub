import { defineAction } from "@agent-native/core";
import { and, eq, sql } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { contacts, focusAccounts } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description:
    "Header stats for the Contacts home page: how many contacts entered the pool in the last 24h, and how many of the caller's own focus accounts have new contacts today.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    // "New today" = createdAt within the last 24h. createdAt (unlike
    // syncedAt) is set once at first insert and never bumped on re-sync/
    // re-score, so it genuinely answers "when did this contact first enter
    // our pool" rather than "when was it last touched."
    const cutoffIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [[newTodayRow], ownFocusAccounts] = await Promise.all([
      db
        .select({ count: sql<number>`count(*)` })
        .from(contacts)
        .where(sql`${contacts.createdAt} >= ${cutoffIso}`),
      db
        .select({ companyName: focusAccounts.companyName })
        .from(focusAccounts)
        .where(eq(focusAccounts.ownerEmail, ctx!.userEmail!)),
    ]);

    const newTodayCount = Number(newTodayRow?.count ?? 0);
    const focusAccountsTotal = ownFocusAccounts.length;

    // Perfectly normal state for an XDR who hasn't set any focus accounts
    // up yet — not an error, just skip the overlap query entirely.
    if (focusAccountsTotal === 0) {
      return { newTodayCount, focusAccountsTotal: 0, focusAccountsWithNewContactsToday: 0 };
    }

    // Company-name match is loose/case-insensitive (no FK between contacts
    // and focus_accounts), matching the convention already used elsewhere
    // in this app (e.g. import-prospects-to-segment.ts, run-sourcing-rule-
    // pipeline.ts). Aggregate to the distinct set of companies with a new
    // contact today rather than pulling every new contact row into memory.
    const newContactCompanies = await db
      .select({ company: sql<string>`LOWER(${contacts.company})` })
      .from(contacts)
      .where(and(sql`${contacts.createdAt} >= ${cutoffIso}`, sql`${contacts.company} IS NOT NULL`))
      .groupBy(sql`LOWER(${contacts.company})`);

    const newCompanySet = new Set(newContactCompanies.map((r) => r.company));
    const focusAccountsWithNewContactsToday = ownFocusAccounts.filter((fa) =>
      newCompanySet.has(fa.companyName.toLowerCase()),
    ).length;

    return { newTodayCount, focusAccountsTotal, focusAccountsWithNewContactsToday };
  },
});
