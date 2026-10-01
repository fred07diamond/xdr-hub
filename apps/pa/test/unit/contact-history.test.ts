// Contact history from HubSpot (D64), against a fake portal.
import { describe, expect, it } from "vitest";

import {
  cleanBody,
  fetchContactHistory,
  firstTouchAfter,
} from "../../server/core/crm/history.js";
import type { HubSpotFetch } from "../../server/core/crm/hubspot-adapter.js";
import { draftPlan } from "../../server/core/drafting/index.js";

const fetch: HubSpotFetch = async (path) => {
  if (path.includes("/associations/emails"))
    return { results: [{ toObjectId: 1 }, { toObjectId: 2 }] };
  if (path.includes("/associations/calls"))
    throw new Error("HubSpot error (403): missing scope");
  if (path.includes("/associations/")) return { results: [] };
  if (path === "/crm/v3/objects/emails/batch/read")
    return {
      results: [
        {
          id: "1",
          properties: {
            hs_timestamp: "2026-09-30T16:20:00.000Z",
            hs_email_direction: "EMAIL",
            hs_email_subject: "Your landing pages",
            hs_email_text: "<p>Hi Sam,&nbsp;thanks for reaching out.</p>",
            hs_email_status: "SENT",
            hs_email_from_email: "rep@example.com",
          },
        },
        {
          id: "2",
          properties: {
            hs_timestamp: "2026-09-29T10:00:00.000Z",
            hs_email_direction: "INCOMING_EMAIL",
            hs_email_subject: "Question",
            hs_email_text: "Older note from the lead",
          },
        },
      ],
    };
  if (path.includes("properties=dobby_message_1"))
    return {
      properties: { dobby_message_1: "Hi Sam, thanks for your interest." },
    };
  throw new Error(`unexpected ${path}`);
};

describe("cleanBody", () => {
  it("keeps paragraphs, writes a doubled link once, and drops the reply chain", () => {
    const text = cleanBody(
      "<p>Hey Sam!</p><p>Thanks for the note.&nbsp;Two quick things.</p><p>Here's my calendar: https://meetings.example.com/rep/intro: https://meetings.example.com/rep/intro</p>\nOn Tue, Sep 30, 2026 at 9:00 AM Sam <sam@example.com> wrote:\n> the original form",
    );
    expect(text).toBe(
      "Hey Sam!\nThanks for the note. Two quick things.\nHere's my calendar: https://meetings.example.com/rep/intro",
    );
  });
});

describe("fetchContactHistory", () => {
  it("reads emails newest first, strips HTML, and reports what it could not read", async () => {
    const history = await fetchContactHistory(fetch, "c1");
    const emails = history.items.filter((item) => item.kind === "email");
    expect(emails.map((item) => item.direction)).toEqual([
      "outbound",
      "inbound",
    ]);
    expect(emails[0].preview).toBe("Hi Sam, thanks for reaching out.");
    expect(history.items.some((item) => item.kind === "dobby")).toBe(true);
    expect(history.unavailable.map((item) => item.kind)).toEqual(["call"]);
  });

  it("finds the first email we sent after the form", async () => {
    const history = await fetchContactHistory(fetch, "c1");
    expect(firstTouchAfter(history, "2026-09-30T16:00:00.000Z")?.title).toBe(
      "Your landing pages",
    );
    expect(firstTouchAfter(history, "2026-09-30T17:00:00.000Z")).toBeNull();
  });
});

describe("drafting after a HubSpot first touch", () => {
  it("does not draft a first touch once one was sent", () => {
    const plan = draftPlan({
      state: "first_touch_sent",
      precheck: "continue",
      hasOwner: true,
    });
    expect(plan.needed).toBe(false);
    expect(plan.reason).toMatch(/already went out from HubSpot/);
  });
});

describe("the first touch (D68)", () => {
  // 30 emails sent after the form, newest last, across two pages of
  // associations: only the newest 20 are shown, but the first touch is the
  // very first one.
  const emails = Array.from({ length: 30 }, (_, index) => ({
    id: String(index + 1),
    properties: {
      hs_timestamp: new Date(
        Date.parse("2026-09-01T10:00:00Z") + index * 86_400_000,
      ).toISOString(),
      hs_email_direction: "EMAIL",
      hs_email_subject: `Touch ${index + 1}`,
      hs_email_text: `Touch ${index + 1}`,
      hs_email_status: "SENT",
    },
  }));
  const busy: HubSpotFetch = async (path, init) => {
    if (path.includes("/associations/emails"))
      return path.includes("after=")
        ? { results: emails.slice(15).map((item) => ({ toObjectId: item.id })) }
        : {
            results: emails
              .slice(0, 15)
              .map((item) => ({ toObjectId: item.id })),
            paging: { next: { after: "15" } },
          };
    if (path.includes("/associations/")) return { results: [] };
    if (path === "/crm/v3/objects/emails/batch/read") {
      const ids = (
        JSON.parse(String(init?.body)) as { inputs: Array<{ id: string }> }
      ).inputs.map((item) => item.id);
      return { results: emails.filter((item) => ids.includes(item.id)) };
    }
    if (path.includes("properties=dobby_message_1")) return { properties: {} };
    throw new Error(`unexpected ${path}`);
  };

  it("is the first email after the first form, not the latest touch", async () => {
    const history = await fetchContactHistory(busy, "c1", {
      firstTouchSince: "2026-09-01T09:00:00Z",
    });
    expect(history.items.filter((item) => item.kind === "email")).toHaveLength(
      20,
    );
    expect(history.firstTouch?.title).toBe("Touch 1");
  });

  it("counts from the form, so emails before it are not the first touch", async () => {
    const history = await fetchContactHistory(busy, "c1", {
      firstTouchSince: "2026-09-10T12:00:00Z",
    });
    expect(history.firstTouch?.title).toBe("Touch 11");
  });
});

describe("a reply thread is not a first touch (D68)", () => {
  // The lead was emailed outside HubSpot; only the thread is logged: a
  // colleague's reply, then our reply to the colleague with the lead on CC.
  const thread = [
    {
      id: "1",
      properties: {
        hs_timestamp: "2026-10-01T01:37:14Z",
        hs_email_direction: "INCOMING_EMAIL",
        hs_email_subject: "Re: your request about the CMS",
        hs_email_from_email: "colleague@example.com",
        hs_email_to_email: "lead@example.com;rep@example.com",
        hs_email_text: "Thanks, see you then.",
      },
    },
    {
      id: "2",
      properties: {
        hs_timestamp: "2026-10-01T18:08:11Z",
        hs_email_direction: "EMAIL",
        hs_email_status: "SENT",
        hs_email_subject: "Re: your request about the CMS",
        hs_email_from_email: "rep@example.com",
        hs_email_to_email: "other@example.com",
        hs_email_text:
          "Hey Sam!\n\nLooking forward to it.\n\nOn Thu, Oct 1, 2026 at 8:13 AM Sam Lee\nwrote:\n\n> Good morning!\n> We are on a headless CMS.",
      },
    },
  ];
  const portal: HubSpotFetch = async (path) => {
    if (path.includes("/associations/emails"))
      return { results: thread.map((item) => ({ toObjectId: item.id })) };
    if (path.includes("/associations/")) return { results: [] };
    if (path === "/crm/v3/objects/emails/batch/read")
      return { results: thread };
    if (path.includes("properties=dobby_message_1")) return { properties: {} };
    throw new Error(`unexpected ${path}`);
  };

  it("shows no first touch, and the thread as proof of contact", async () => {
    const history = await fetchContactHistory(portal, "c1", {
      firstTouchSince: "2026-09-30T19:59:18Z",
      leadEmail: "lead@example.com",
    });
    expect(history.firstTouch).toBeNull();
    expect(history.threadEvidence?.at).toBe("2026-10-01T01:37:14Z");
  });

  it("drops a wrapped reply header and the quoted lines", () => {
    expect(cleanBody(thread[1].properties.hs_email_text)).toBe(
      "Hey Sam!\n\nLooking forward to it.",
    );
    expect(cleanBody("Hi\n> quoted\nThanks")).toBe("Hi\nThanks");
  });

  it("takes a first email addressed to the lead", () => {
    const sent = firstTouchAfter(
      {
        items: [
          {
            id: "a",
            kind: "email",
            direction: "outbound",
            at: "2026-10-01T09:00:00Z",
            title: "Your CMS request",
            preview: "Hi",
            from: "rep@example.com",
            to: "lead@example.com",
            status: "SENT",
          },
        ],
        unavailable: [],
      },
      "2026-09-30T19:59:18Z",
      "LEAD@example.com",
    );
    expect(sent?.id).toBe("a");
  });
});
