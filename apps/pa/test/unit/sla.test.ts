// The SLA timer and the sales cycle (D51): the timer marks first contact and
// the SAL decision; the cycle runs MQL, QL, SAL, S0, NBM booked, NBM complete, S1.
import { describe, expect, it } from "vitest";

import { buildDemoData } from "../../server/core/demo/index.js";
import type {
  EngagementRecord,
  EventRecord,
} from "../../server/core/repo/types.js";
import { salesCycleView, slaView } from "../../server/core/views/sla.js";
import type { ClockView } from "../../shared/pa-views.js";

const now = new Date("2026-09-30T18:00:00.000Z");
const submittedAt = "2026-09-30T17:00:00.000Z";
const clock = (status: ClockView["status"]): ClockView => ({
  status,
  summary: "",
  reason: "60 working minutes in PA One's hours",
  dueAt: "2026-09-30T18:00:00.000Z",
  startsAt: submittedAt,
  fraction: status === "met" ? 1 : 0.5,
  reminderFraction: 0.75,
  remainingMinutes: 30,
  elapsedMinutes: 30,
  totalMinutes: 60,
  ownerTimezone: "America/Los_Angeles",
});
const engagement = (patch: Partial<EngagementRecord> = {}) =>
  ({
    firstTouchAt: null,
    decisionDueAt: "2026-10-01T17:00:00.000Z",
    ...patch,
  }) as EngagementRecord;
const salEvent: EventRecord = {
  id: "e",
  engagementId: "x",
  correlationId: "c",
  type: "state.changed",
  actor: "user:pa",
  payload: { from: "ql", to: "sal" },
  receiptId: null,
  occurredAt: "2026-09-30T19:00:00.000Z",
};

describe("slaView", () => {
  it("is on first contact until a person contacts the lead", () => {
    const sla = slaView({
      engagement: engagement(),
      clock: clock("running"),
      events: [],
      submittedAt,
      now,
    });
    expect(sla.phase).toBe("contact");
    expect(sla.label).toBe("Contact in 30m");
    expect(sla.sal.label).toMatch(/^SAL decision in/);
  });

  it("moves to the SAL decision once contacted, then finishes at SAL", () => {
    const contacted = engagement({ firstTouchAt: "2026-09-30T17:20:00.000Z" });
    const onSal = slaView({
      engagement: contacted,
      clock: clock("met"),
      events: [],
      submittedAt,
      now,
    });
    expect(onSal.phase).toBe("sal");
    expect(onSal.label).toBe("SAL decision in 23h");
    expect(onSal.contact.doneAt).toBe("2026-09-30T17:20:00.000Z");

    const done = slaView({
      engagement: contacted,
      clock: clock("met"),
      events: [salEvent],
      submittedAt,
      now,
    });
    expect(done.phase).toBe("done");
    expect(done.label).toBe("Contacted and SAL");
    expect(done.sal.doneAt).toBe(salEvent.occurredAt);
  });

  it("flags a late SAL decision", () => {
    const sla = slaView({
      engagement: engagement({
        firstTouchAt: "2026-09-30T17:20:00.000Z",
        decisionDueAt: "2026-09-30T17:30:00.000Z",
      }),
      clock: clock("met"),
      events: [],
      submittedAt,
      now,
    });
    expect(sla.status).toBe("breached");
    expect(sla.label).toBe("SAL decision overdue");
  });
});

describe("the SLA timer follows HubSpot (D83)", () => {
  it("counts a first touch even when no clock ran", () => {
    const sla = slaView({
      engagement: engagement({
        firstTouchAt: "2026-09-30T17:20:00.000Z",
      }),
      clock: { ...clock("none"), reason: "No clock: no human owner" },
      events: [],
      submittedAt,
      now,
    });
    expect(sla.contact.status).toBe("met");
    expect(sla.phase).toBe("sal");
  });

  it("ends at the stage HubSpot has: SAL, recycled, or disqualified", () => {
    const contacted = engagement({ firstTouchAt: "2026-09-30T17:20:00.000Z" });
    const cases = [
      ["sal", "Contacted and SAL", "SAL in HubSpot"],
      ["recycle", "Contacted and recycled", "Recycled in HubSpot"],
      ["disqualified", "Contacted and disqualified", "Disqualified in HubSpot"],
    ] as const;
    for (const [stage, label, salLabel] of cases) {
      const sla = slaView({
        engagement: contacted,
        clock: clock("met"),
        events: [],
        submittedAt,
        now,
        crmStage: stage,
      });
      expect(sla.phase).toBe("done");
      expect(sla.label).toBe(label);
      expect(sla.sal.label).toBe(salLabel);
    }
    // Recycled before anyone contacted them: no contact countdown either.
    const early = slaView({
      engagement: engagement(),
      clock: clock("running"),
      events: [],
      submittedAt,
      now,
      crmStage: "recycle",
    });
    expect(early.label).toBe("Recycled in HubSpot");
  });

  it("reads HubSpot's lifecycle labels", async () => {
    const { hubspotStage, latestLifecycle } =
      await import("../../server/core/crm/lifecycle.js");
    expect(hubspotStage("Recycle")).toBe("recycle");
    expect(hubspotStage("SAL")).toBe("sal");
    expect(hubspotStage("S0")).toBe("sal");
    expect(hubspotStage("Disqualified")).toBe("disqualified");
    expect(hubspotStage("QL")).toBeNull();
    expect(
      latestLifecycle(
        [{ type: "crm.lifecycle_checked", payload: { lifecycle: "Recycle" } }],
        "QL",
      ),
    ).toBe("Recycle");
  });
});

describe("salesCycleView", () => {
  const base = {
    submittedAt,
    scoredAt: submittedAt,
    events: [] as EventRecord[],
    crmLifecycle: null,
  };

  it("puts every sales lead at QL, on the way to SAL or Recycle", () => {
    const stages = salesCycleView({
      ...base,
      verdict: "ql",
      triageKind: "reply",
    });
    expect(stages.map((stage) => stage.label)).toEqual([
      "MQL",
      "QL",
      "SAL or Recycle",
      "S0",
      "NBM booked",
      "NBM complete",
      "S1",
    ]);
    expect(stages.map((stage) => stage.status)).toEqual([
      "done",
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
    expect(stages[3].note).toMatch(/HubSpot/);
  });

  it("stops a lead that is not a sales opportunity at MQL", () => {
    const stages = salesCycleView({
      ...base,
      verdict: "route_elsewhere",
      triageKind: "elsewhere",
    });
    expect(stages[1].status).toBe("stopped");
  });

  it("forks to Recycle when HubSpot or the rep recycles the lead", () => {
    for (const input of [
      { crmLifecycle: "Recycle" },
      { decisionChoice: "decline" },
    ]) {
      const stages = salesCycleView({
        ...base,
        ...input,
        verdict: null,
        triageKind: "reply",
      });
      expect(stages[2]).toMatchObject({ label: "Recycle", status: "stopped" });
      expect(
        stages.slice(3).every((stage) => stage.status === "upcoming"),
      ).toBe(true);
    }
  });

  it("reads SAL from HubSpot for an owned contact", () => {
    const stages = salesCycleView({
      ...base,
      verdict: "attach_existing",
      crmLifecycle: "SAL",
      triageKind: "owner",
    });
    expect(stages.slice(0, 4).map((stage) => stage.status)).toEqual([
      "done",
      "done",
      "done",
      "current",
    ]);
  });
});

describe("the demo board's SLA timer", () => {
  it("shows contact SLAs for leads a person must contact, and none otherwise", async () => {
    const demo = await buildDemoData({ now: new Date("2026-09-30T20:00:00Z") });
    const board = await demo.board("team", null);
    const byName = new Map(board.rows.map((row) => [row.lead.name, row]));
    expect(byName.get("Priya Natarajan")!.sla.phase).toBe("contact");
    expect(byName.get("Sam Whitfield")!.sla.phase).toBe("none");
    expect(byName.get("Sam Whitfield")!.sla.label).toBe("No SLA");
    const detail = await demo.engagement(byName.get("Priya Natarajan")!.id);
    expect(
      detail!.salesCycle.find((stage) => stage.status === "current")?.label,
    ).toBe("SAL or Recycle");
  });
});
