// The live path (D54) against a fake HubSpot: intake, the adapter's mapping,
// and the pipeline waiting for the agent instead of failing. No live calls.
import { describe, expect, it } from "vitest";

import {
  canonicalStage,
  HubSpotCrmAdapter,
  type HubSpotFetch,
} from "../../server/core/crm/hubspot-adapter.js";
import {
  enqueueSubmissions,
  searchContactSales,
  toSubmission,
} from "../../server/core/intake/hubspot.js";
import { runPipeline } from "../../server/core/pipeline/runner.js";
import type { PipelineDeps } from "../../server/core/pipeline/types.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import { fixedClock, idFactory } from "../helpers.js";

const contactSales = (id: string, email: string, when: string) => ({
  id,
  properties: {
    email,
    firstname: "Sam",
    lastname: "Lee",
    company: "Example Corp",
    country: "US",
    message: "We want to move our marketing site to a headless CMS.",
    what_is_your_use_case__contact_sales_: "Headless CMS",
    company_fit_score___breeze: "7",
    most_recent_contact_sales_date: String(Date.parse(when.slice(0, 10))),
    most_recently_contact_sales_date__date_time_: when,
  },
});

/** A fake portal: one new contact with no owner, company, or deals. */
function fakeHubSpot(pages: Array<ReturnType<typeof contactSales>[]>) {
  const calls: string[] = [];
  let page = 0;
  const fetch: HubSpotFetch = async (path, init) => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    if (path === "/crm/v3/objects/contacts/search") {
      const body = JSON.parse(init?.body ?? "{}");
      if (body.filterGroups[0].filters[0].propertyName === "email")
        return {
          results: [
            {
              id: "c1",
              properties: {
                email: "sam@example.com",
                lifecyclestage: "9000001",
                hubspot_owner_id: null,
              },
            },
          ],
        };
      const results = pages[page] ?? [];
      page += 1;
      return {
        results,
        ...(page < pages.length
          ? { paging: { next: { after: String(page) } } }
          : {}),
      };
    }
    if (path.startsWith("/crm/v3/properties/contacts/lifecyclestage"))
      return {
        options: [
          { value: "9000001", label: "RAW" },
          { value: "9000002", label: "SAL" },
        ],
      };
    if (path.includes("/associations/")) return { results: [] };
    throw new Error(`unexpected ${path}`);
  };
  return { fetch, calls };
}

describe("HubSpot intake", () => {
  it("turns a submission into one inbox row, keyed by contact and time", () => {
    const submission = toSubmission(
      contactSales("c1", "sam@example.com", "2026-09-30T15:04:00.000Z"),
    )!;
    expect(submission.externalId).toBe("c1:2026-09-30T15:04:00.000Z");
    expect(submission.payload).toMatchObject({
      email: "sam@example.com",
      name: "Sam Lee",
      message: "We want to move our marketing site to a headless CMS.",
      fields: { use_case: "Headless CMS", breeze_fit_score: "7" },
      crm_contact_id: "c1",
    });
  });

  it("pages through results and drops submissions older than the window", async () => {
    const { fetch } = fakeHubSpot([
      [contactSales("c1", "a@example.com", "2026-09-30T15:00:00.000Z")],
      [contactSales("c2", "b@example.com", "2026-09-20T15:00:00.000Z")],
    ]);
    const found = await searchContactSales(fetch, {
      since: new Date("2026-09-28T00:00:00.000Z"),
      limit: 50,
    });
    expect(found.map((item) => item.contactId)).toEqual(["c1"]);
  });

  it("is idempotent: a re-poll adds nothing", async () => {
    const repo = new MemoryRepository();
    const clock = fixedClock();
    const deps = { now: clock.now, newId: idFactory(clock) };
    const submission = toSubmission(
      contactSales("c1", "sam@example.com", "2026-09-30T15:04:00.000Z"),
    )!;
    expect(await enqueueSubmissions(repo, [submission], deps)).toHaveLength(1);
    expect(await enqueueSubmissions(repo, [submission], deps)).toHaveLength(0);
  });
});

describe("HubSpotCrmAdapter", () => {
  it("maps this portal's custom lifecycle labels to PA's stages", () => {
    expect(canonicalStage("RAW")).toBe("lead");
    expect(canonicalStage("MEL")).toBe("mql");
    expect(canonicalStage("SAL")).toBe("sal");
    expect(canonicalStage("S1")).toBe("opportunity");
    expect(canonicalStage("Recycle")).toBeNull();
  });

  it("reads the lifecycle label through the property definition", async () => {
    const clock = fixedClock();
    const { fetch } = fakeHubSpot([]);
    const adapter = new HubSpotCrmAdapter(fetch, {}, clock.now);
    const contact = await adapter.findContactByEmail("sam@example.com");
    expect(contact).toMatchObject({ lifecycleRaw: "RAW", lifecycle: "lead" });
    await expect(adapter.logEmail()).rejects.toThrow(/M2/);
  });
});

describe("the live pipeline waits for the agent", () => {
  it("halts at the assessment, asks the agent once, and never fails the row", async () => {
    const repo = new MemoryRepository();
    const clock = fixedClock();
    const { fetch } = fakeHubSpot([]);
    const deps: PipelineDeps = {
      repo,
      crm: new HubSpotCrmAdapter(fetch, {}, clock.now),
      release: seedRelease,
      assessor: {
        source: "agent",
        waitsForAgent: true,
        assess: async () => null,
      },
      drafter: {
        source: "agent",
        waitsForAgent: true,
        draft: async () => null,
      },
      now: clock.now,
      newId: idFactory(clock),
      devPool: [],
      mode: "shadow",
    };
    const [row] = await enqueueSubmissions(
      repo,
      [
        toSubmission(
          contactSales("c1", "sam@example.com", "2026-09-29T17:00:00.000Z"),
        )!,
      ],
      { now: clock.now, newId: deps.newId },
    );
    const run = await runPipeline(row.id, deps);
    expect(run.status).toBe("done");
    expect(run.steps.map((step) => `${step.step}:${step.status}`)).toEqual([
      "normalize:done",
      "crm_snapshot:done",
      "assess_message:halt",
    ]);
    const events = await repo.listEventsByCorrelation(row.id);
    expect(
      events.filter((event) => event.type === "agent.work_requested"),
    ).toHaveLength(1);
    expect((await repo.getInbox(row.id))?.status).toBe("done");
  });
});
