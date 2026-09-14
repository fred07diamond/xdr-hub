import { defineAction } from "@agent-native/core";
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { prospects } from "../server/db/schema.js";
import { enrichApolloRecord } from "../server/helpers/enrich-apollo-record.js";
import { checkRateLimit } from "../server/helpers/rate-limit.js";

export default defineAction({
  description:
    "Enrich a single captured prospect with Apollo.io person + company data (email, title, LinkedIn URL, company industry/size). On-demand only — never runs automatically at capture time.",
  schema: z.object({
    id: z.string(),
  }),
  requiresAuth: true,
  http: { method: "POST" },
  run: async ({ id }, ctx) => {
    const db = getDb();
    const ownerFilter = ctx?.userEmail
      ? eq(prospects.ownerEmail, ctx.userEmail)
      : isNull(prospects.ownerEmail);

    const rows = await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.id, id), ownerFilter))
      .limit(1);
    const prospect = rows[0];
    if (!prospect) throw new Error("Prospect not found or access denied");

    // Raised from 100/hr to match enrich-lead-list-item.ts -- real xDR usage
    // runs ~500 leads/day, often enriched in one sitting.
    if (!(await checkRateLimit(ctx?.userEmail ?? "anonymous", "enrich-prospect", 1000))) {
      return { ok: false, error: "Rate limit reached — try again shortly." };
    }

    if (!prospect.name) {
      return { ok: false, error: "Prospect has no name to match against Apollo." };
    }

    // The Apollo call, the freshness short-circuit, the phone-reveal
    // bookkeeping and the row write all live in enrichApolloRecord, shared
    // with the lead-list path and the background sweep. This action used to
    // inline a verbatim copy of ~70 lines of that, differing only in which
    // table it wrote to; the two copies had already drifted once, and credit
    // metering has to sit at a single choke point or a call site can spend
    // without being counted.
    const result = await enrichApolloRecord(
      db,
      { kind: "prospect", row: prospect },
      { trigger: ctx?.caller === "tool" ? "agent" : "manual", actorEmail: ctx?.userEmail ?? null },
    );

    // A budget/allowance refusal is reported with a machine-readable code
    // so a bulk loop can STOP rather than retrying N times against a
    // closed budget and swallowing every rejection.
    if (result.blockedReason) {
      return { ok: false, code: result.blockedReason, error: result.blockedMessage };
    }

    return { ok: true, ...result };
  },
});
