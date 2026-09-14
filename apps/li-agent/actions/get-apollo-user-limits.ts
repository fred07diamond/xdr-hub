import { defineAction } from "@agent-native/core";
import { z } from "zod";

import { getEnrichmentBudgetState } from "../server/helpers/apollo-credits/guard.js";
import { getSpendByUser } from "../server/helpers/apollo-credits/ledger.js";
import { listUserCreditLimits } from "../server/helpers/apollo-credits/user-limits.js";
import { requireAdmin } from "../server/helpers/require-admin.js";
import { listWorkspaceMembersForCredits } from "../server/helpers/apollo-credits/members.js";

// Feeds the admin per-user allocation table: every workspace member, their
// spend this period, and their allowance (explicit or inherited).
export default defineAction({
  description:
    "Per-user Apollo credit allowances and this period's spend for every workspace member, for the admin allocation table.",
  schema: z.object({}),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async (_input, ctx) => {
    await requireAdmin(ctx);

    const state = await getEnrichmentBudgetState();
    const [members, explicitLimits, spendRows] = await Promise.all([
      listWorkspaceMembersForCredits(),
      listUserCreditLimits(),
      getSpendByUser(state.period.key),
    ]);

    const limitByEmail = new Map(explicitLimits.map((l) => [l.userEmail.toLowerCase(), l.creditLimit]));
    const spendByEmail = new Map(spendRows.map((r) => [r.actorEmail.toLowerCase(), r]));

    // Anyone who has SPENT this period but is not in the members list still
    // has to appear -- otherwise their spend would be invisible here while
    // counting against the workspace total, which is exactly the kind of
    // discrepancy that makes an admin distrust the whole page.
    const emails = new Set<string>(members.map((m) => m.email.toLowerCase()));
    for (const r of spendRows) emails.add(r.actorEmail.toLowerCase());

    const roleByEmail = new Map(members.map((m) => [m.email.toLowerCase(), m.role]));

    const rows = [...emails].map((email) => {
      const explicit = limitByEmail.get(email) ?? null;
      const limit = explicit ?? state.settings.userDefaultLimit;
      const spent = spendByEmail.get(email)?.credits ?? 0;
      return {
        userEmail: email,
        role: roleByEmail.get(email) ?? "none",
        // null means "inherits the workspace default", which the UI renders
        // differently from an explicit value that happens to equal it.
        explicitLimit: explicit,
        effectiveLimit: limit,
        spent,
        remaining: Math.max(0, limit - spent),
        calls: spendByEmail.get(email)?.calls ?? 0,
      };
    });
    rows.sort((a, b) => b.spent - a.spent || a.userEmail.localeCompare(b.userEmail));

    const allocated = rows.reduce((sum, r) => sum + r.effectiveLimit, 0);

    return {
      periodStart: state.period.key,
      resetLabel: state.resetLabel,
      workspaceBudget: state.budget,
      workspaceSpent: state.spent,
      userDefaultLimit: state.settings.userDefaultLimit,
      rows,
      // Allowances are independent CEILINGS, not an allocation that has to
      // balance -- but an admin should be told when they sum past the
      // workspace budget, so it is a choice rather than a surprise.
      totalAllocated: allocated,
      overAllocated: allocated > state.budget,
    };
  },
});
