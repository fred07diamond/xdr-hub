import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { leadOwnerEmail } from "../server/core/outreach/delivery.js";
import { repo, now } from "../server/lib/pa-context.js";

export default defineAction({
  description:
    "Open follow-ups across every lead (D101, the Sequencing page): which are due or ready to send, and which come up next, with the lead, its owner, the step, and the day. Read only.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const repository = repo();
    const me = ctx?.userEmail?.toLowerCase() ?? null;
    const at = now().toISOString();
    const rows = await repository.listOpenFollowUps();
    const counts = new Map<string, number>();
    const items = [];
    for (const row of rows) {
      const engagement = await repository.getEngagement(row.engagementId);
      if (!engagement) continue;
      if (!counts.has(row.engagementId))
        counts.set(
          row.engagementId,
          (await repository.listFollowUps(row.engagementId)).length,
        );
      const contact = await repository.getContact(engagement.contactId);
      const owner = await leadOwnerEmail(repository, engagement);
      items.push({
        id: row.id,
        engagementId: row.engagementId,
        lead: contact?.name ?? contact?.email ?? "Unknown lead",
        leadEmail: contact?.email ?? null,
        owner,
        mine: Boolean(me && owner === me),
        route: row.route,
        step: row.stepIndex,
        of: counts.get(row.engagementId) ?? row.stepIndex,
        day: row.day,
        purpose: row.purpose,
        status: row.status,
        dueAt: row.dueAt,
        due: row.dueAt <= at,
      });
    }
    // One row per lead: its next open follow-up.
    const seen = new Set<string>();
    const next = items.filter((item) => {
      if (seen.has(item.engagementId)) return false;
      seen.add(item.engagementId);
      return true;
    });
    return {
      due: next.filter((item) => item.due),
      upcoming: next.filter((item) => !item.due),
      activeLeads: next.length,
    };
  },
});
