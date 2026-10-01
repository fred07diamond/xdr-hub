// The board and record summary render from demo data without errors, and the
// first thing on each is the classification and the draft (D49).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vitest";

import { SalesCycle } from "../../app/components/pa/clock.js";
import { BoardTable } from "../../app/components/pa/inbound-board.js";
import {
  DraftCard,
  LeadRouteBlock,
  TriageCard,
} from "../../app/components/pa/triage.js";
import { buildDemoData } from "../../server/core/demo/index.js";

describe("triage UI", () => {
  it("renders the board with a classification and a draft preview per row", async () => {
    const demo = await buildDemoData({ now: new Date("2026-09-30T20:00:00Z") });
    const board = await demo.board("team", null);
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <BoardTable
          rows={board.rows}
          now={Date.parse(board.generatedAt)}
          tab="team"
          selected={new Set()}
          onToggle={() => {}}
          onToggleAll={() => {}}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Classified as");
    expect(html).toContain("Drafted reply");
    expect(html).toContain("Requires discovery");
    expect(html).not.toContain("Verdict");
    expect(html).toContain("Replatforming your storefront content");
    expect(html).toContain("?tab=team");
  });

  it("renders the record summary: classification, then the draft", async () => {
    const demo = await buildDemoData({ now: new Date("2026-09-30T20:00:00Z") });
    const board = await demo.board("team", null);
    const row = board.rows.find(
      (item) => item.lead.name === "Priya Natarajan",
    )!;
    const detail = (await demo.engagement(row.id))!;
    const html = renderToStaticMarkup(
      <>
        <TriageCard
          triage={detail.triage}
          asked={{
            text: detail.assessment?.explicitQuestion ?? null,
            source: "question",
          }}
          facts={[]}
        />
        <DraftCard draft={detail.draft} onAsk={() => {}} />
        <SalesCycle stages={detail.salesCycle} sla={detail.sla} />
      </>,
    );
    expect(html).toContain("How it was classified");
    expect(html).toContain("Review the draft reply.");
    expect(html).toContain("Requires discovery, Content");
    expect(html).not.toContain("[time options]");
    expect(html).not.toContain("[calendar link]");
    expect(html).toContain("Nothing is sent automatically");
    expect(html).toContain("SLA timer");
    expect(html).toContain("NBM complete");
    expect(html).toContain(detail.sla.label);
    expect(detail.sla.phase).toBe("contact");
    // Next step closes the classification card, after their question.
    expect(html.indexOf("They asked")).toBeLessThan(html.indexOf("Next step"));
    expect(html.indexOf("How it was classified")).toBeLessThan(
      html.indexOf("Drafted reply"),
    );
  });

  it("shows the route: who takes the meeting and the link, or what is missing", () => {
    const html = renderToStaticMarkup(
      <MemoryRouter>
        <LeadRouteBlock
          value={{
            route: "route_to_ae",
            label: "Route to the AE",
            email: "Include the AE's meeting link as the ask.",
            reason: "From the lead's class and the playbook's routing rule.",
            source: "playbook",
            meetingWith: {
              email: "ae@example.com",
              name: "Alex",
              role: "ae",
              link: null,
            },
            gaps: ["No meeting link for Alex. Add it on the Team page."],
            canOverride: true,
            paOwner: null,
          }}
          onChange={() => {}}
        />
      </MemoryRouter>,
    );
    expect(html).toContain("Route to the AE");
    expect(html).toContain("with Alex (AE)");
    expect(html).toContain("Playbook: Route to the AE");
    expect(html).toContain("PA takes the call");
    expect(html).toContain('href="/team"');
  });
});
