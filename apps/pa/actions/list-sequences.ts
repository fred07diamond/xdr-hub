import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { STOPPED_EVENT } from "../server/lib/follow-ups.js";
import { now, repo } from "../server/lib/pa-context.js";
import { ensureSequences } from "../server/lib/sequences.js";
import { orderedSteps } from "../shared/sequences.js";

export default defineAction({
  description:
    "The team's sequences (D105): name, kind (dynamic: agent-written, approved per email; template: editable emails approved at enrollment), recommended routes, steps, and results per sequence and per step (sent, replies, meetings). Read only.",
  schema: z.object({
    includeArchived: z.boolean().optional(),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ includeArchived }) => {
    const repository = repo();
    const sequences = await ensureSequences(repository);
    const since = new Date(now().getTime() - 365 * 86_400_000).toISOString();
    const rows = await repository.listFollowUpsSince(since);
    const out = [];
    for (const sequence of sequences) {
      if (sequence.archived && !includeArchived) continue;
      const steps = orderedSteps(sequence.steps);
      const stats = steps.map(() => ({ sent: 0, replies: 0, meetings: 0 }));
      const leads = new Map<string, typeof rows>();
      for (const row of rows.filter((item) => item.sequenceId === sequence.id))
        leads.set(row.engagementId, [
          ...(leads.get(row.engagementId) ?? []),
          row,
        ]);
      let active = 0;
      for (const [engagementId, leadRows] of leads) {
        const ordered = [...leadRows].sort((a, b) => a.stepIndex - b.stepIndex);
        if (
          ordered.some((row) =>
            ["scheduled", "drafted", "needs_edit", "approved"].includes(
              row.status,
            ),
          )
        )
          active += 1;
        ordered.forEach((row, index) => {
          if (row.status === "sent" && stats[index]) stats[index].sent += 1;
        });
        const stop = (await repository.listEvents(engagementId)).find(
          (item) =>
            item.type === STOPPED_EVENT &&
            (item.payload.kind === "reply" ||
              item.payload.kind === "meeting") &&
            ordered.some((row) => row.stopReason === item.payload.reason),
        );
        if (!stop) continue;
        let credited = -1;
        ordered.forEach((row, index) => {
          if (
            row.status === "sent" &&
            row.sentAt &&
            row.sentAt <= stop.occurredAt
          )
            credited = index;
        });
        if (credited < 0) continue;
        if (stop.payload.kind === "reply") stats[credited].replies += 1;
        else stats[credited].meetings += 1;
      }
      out.push({
        id: sequence.id,
        name: sequence.name,
        kind: sequence.kind,
        description: sequence.description,
        recommendedFor: sequence.recommendedFor,
        archived: sequence.archived,
        updatedBy: sequence.updatedBy,
        updatedAt: sequence.updatedAt,
        version: sequence.version,
        steps: steps.map((step, index) => ({ ...step, stats: stats[index] })),
        enrolled: leads.size,
        active,
        sent: stats.reduce((total, item) => total + item.sent, 0),
        replies: stats.reduce((total, item) => total + item.replies, 0),
        meetings: stats.reduce((total, item) => total + item.meetings, 0),
      });
    }
    return { sequences: out };
  },
});
