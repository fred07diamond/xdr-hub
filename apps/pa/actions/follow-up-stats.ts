import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { LABELED_EVENT, STOPPED_EVENT } from "../server/lib/follow-ups.js";
import { now, repo } from "../server/lib/pa-context.js";
import { CADENCE_ROUTES } from "../shared/cadence.js";

interface StepStats {
  step: number;
  day: number | null;
  sent: number;
  replies: number;
  interested: number;
  meetings: number;
  edited: number;
}

export default defineAction({
  description:
    "Follow-up results (D103, the Sequencing page): per route and per step, how many leads, follow-ups sent, replies (each credited to the last follow-up sent before it; step 0 is the first touch), interested replies (interested or referral), meetings, bounces, how often people edited the agent's draft, and why cadences stopped. Replies and meetings, not opens. Read only.",
  schema: z.object({
    days: z.coerce.number().int().min(7).max(365).optional().default(90),
  }),
  http: { method: "GET" },
  readOnly: true,
  run: async ({ days }) => {
    const repository = repo();
    const since = new Date(now().getTime() - days * 86_400_000).toISOString();
    const rows = await repository.listFollowUpsSince(since);
    const byLead = new Map<string, typeof rows>();
    for (const row of rows)
      byLead.set(row.engagementId, [
        ...(byLead.get(row.engagementId) ?? []),
        row,
      ]);
    const routes = new Map<
      string,
      {
        leads: number;
        active: number;
        bounced: number;
        optedOut: number;
        steps: Map<number, StepStats>;
      }
    >();
    const reasons = new Map<string, number>();
    const stepOf = (route: string, step: number, day: number | null) => {
      let entry = routes.get(route);
      if (!entry) {
        entry = {
          leads: 0,
          active: 0,
          bounced: 0,
          optedOut: 0,
          steps: new Map(),
        };
        routes.set(route, entry);
      }
      let stats = entry.steps.get(step);
      if (!stats) {
        stats = {
          step,
          day,
          sent: 0,
          replies: 0,
          interested: 0,
          meetings: 0,
          edited: 0,
        };
        entry.steps.set(step, stats);
      }
      return { entry, stats };
    };
    for (const [engagementId, leadRows] of byLead) {
      const route = leadRows[0].route;
      const { entry } = stepOf(route, 0, 0);
      entry.leads += 1;
      if (
        leadRows.some((row) =>
          ["scheduled", "drafted", "needs_edit", "approved"].includes(
            row.status,
          ),
        )
      )
        entry.active += 1;
      for (const row of leadRows) {
        const { stats } = stepOf(route, row.stepIndex, row.day);
        if (row.status === "sent") {
          stats.sent += 1;
          if (row.editedBy) stats.edited += 1;
        }
      }
      const events = await repository.listEvents(engagementId);
      const stop = events.find(
        (item) =>
          item.type === STOPPED_EVENT && item.payload.kind !== "company",
      );
      if (stop) {
        const reason = String(stop.payload.reason ?? "Stopped");
        const key = /^Stopped by|^Skipped by/.test(reason)
          ? "Stopped by a person"
          : reason;
        reasons.set(key, (reasons.get(key) ?? 0) + 1);
        // Credit the last follow-up sent before the stop; 0 is the first touch.
        const credited =
          leadRows
            .filter(
              (row) =>
                row.status === "sent" &&
                row.sentAt &&
                row.sentAt <= stop.occurredAt,
            )
            .map((row) => row.stepIndex)
            .sort((a, b) => b - a)[0] ?? 0;
        const { stats } = stepOf(route, credited, credited === 0 ? 0 : null);
        if (stop.payload.kind === "reply") {
          stats.replies += 1;
          const label = [...events]
            .reverse()
            .find((item) => item.type === LABELED_EVENT)?.payload.label;
          if (label === "interested" || label === "referral")
            stats.interested += 1;
          if (label === "unsubscribe") entry.optedOut += 1;
        }
        if (stop.payload.kind === "meeting") stats.meetings += 1;
        if (stop.payload.kind === "bounce") entry.bounced += 1;
        if (stop.payload.kind === "opted_out") entry.optedOut += 1;
      }
    }
    const label = (route: string) =>
      CADENCE_ROUTES.find((item) => item.route === route)?.label ?? route;
    return {
      days,
      routes: [...routes.entries()].map(([route, entry]) => {
        const steps = [...entry.steps.values()].sort((a, b) => a.step - b.step);
        const sum = (key: keyof StepStats) =>
          steps.reduce((total, item) => total + Number(item[key] ?? 0), 0);
        const sent = sum("sent");
        return {
          route,
          label: label(route),
          leads: entry.leads,
          active: entry.active,
          sent,
          replies: sum("replies"),
          interested: sum("interested"),
          meetings: sum("meetings"),
          bounced: entry.bounced,
          optedOut: entry.optedOut,
          editedPct: sent ? Math.round((sum("edited") / sent) * 100) : null,
          replyRate: entry.leads
            ? Math.round((sum("replies") / entry.leads) * 100)
            : null,
          steps,
        };
      }),
      stopReasons: [...reasons.entries()]
        .map(([reason, count]) => ({ reason, count }))
        .sort((a, b) => b.count - a.count),
    };
  },
});
