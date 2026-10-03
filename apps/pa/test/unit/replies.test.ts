// Reading replies and time zones for follow-ups (D103).
import { describe, expect, it } from "vitest";

import {
  isBounce,
  isOutOfOffice,
  returnDateOf,
  signalSince,
  type InboundEmail,
} from "../../server/core/outreach/replies.js";
import {
  fromHubSpotTimezone,
  leadTimezone,
} from "../../server/core/outreach/timezone.js";

const NOW = new Date("2026-10-05T16:00:00.000Z");
const email = (patch: Partial<InboundEmail>): InboundEmail => ({
  id: "e1",
  at: "2026-10-04T10:00:00.000Z",
  title: "Re: Your portal question",
  preview: "Thanks, this is helpful. Can we talk Thursday?",
  from: "lead@prospect.example",
  direction: "inbound",
  status: null,
  ...patch,
});

describe("reading replies", () => {
  it("tells an out-of-office from a reply, and reads the return date", () => {
    expect(
      isOutOfOffice(email({ title: "Automatic reply: Your portal question" })),
    ).toBe(true);
    expect(
      isOutOfOffice(
        email({ preview: "I am out of the office until October 12." }),
      ),
    ).toBe(true);
    expect(isOutOfOffice(email({}))).toBe(false);
    expect(
      returnDateOf(
        "I'm away until October 12th, back on the 13th",
        NOW,
      )?.toISOString(),
    ).toBe("2026-10-12T16:00:00.000Z");
    expect(
      returnDateOf("On leave from 1 Oct to 14 Oct", NOW)?.getUTCDate(),
    ).toBe(14);
    expect(returnDateOf("Back 10/20", NOW)?.toISOString().slice(0, 10)).toBe(
      "2026-10-20",
    );
    // A date already past rolls to next year; too far out is a misread.
    expect(
      returnDateOf(
        "back on Jan 3",
        new Date("2026-12-20T16:00:00.000Z"),
      )?.getUTCFullYear(),
    ).toBe(2027);
    expect(returnDateOf("Back in March 2027 March 30", NOW)).toBeNull();
    expect(returnDateOf("no date here", NOW)).toBeNull();
  });

  it("spots a bounce from the sender, the subject, or HubSpot's status", () => {
    expect(isBounce(email({ from: "MAILER-DAEMON@google.com" }))).toBe(true);
    expect(
      isBounce(email({ title: "Undeliverable: Your portal question" })),
    ).toBe(true);
    expect(isBounce(email({ direction: "outbound", status: "BOUNCED" }))).toBe(
      true,
    );
    expect(isBounce(email({}))).toBe(false);
  });

  it("orders the signals: bounce, meeting, reply, then out-of-office", () => {
    const since = "2026-10-01T00:00:00.000Z";
    const base = { since, meetings: [], handled: new Set<string>(), now: NOW };
    const away = email({ id: "ooo", preview: "Out of office until October 9" });
    expect(signalSince({ ...base, emails: [away] })).toMatchObject({
      kind: "out_of_office",
    });
    // A real reply wins over an out-of-office.
    expect(
      signalSince({ ...base, emails: [away, email({ id: "r" })] })?.kind,
    ).toBe("reply");
    // A handled out-of-office is not seen again.
    expect(
      signalSince({ ...base, emails: [away], handled: new Set(["ooo"]) }),
    ).toBeNull();
    // Older than the first touch: ignored.
    expect(
      signalSince({
        ...base,
        emails: [email({ at: "2026-09-30T00:00:00.000Z" })],
      }),
    ).toBeNull();
    expect(
      signalSince({
        ...base,
        emails: [email({ id: "r" })],
        meetings: [{ at: "2026-10-03T00:00:00.000Z" }],
      })?.kind,
    ).toBe("meeting");
    expect(
      signalSince({
        ...base,
        emails: [
          email({ id: "r" }),
          email({ id: "b", from: "postmaster@x.com" }),
        ],
      })?.kind,
    ).toBe("bounce");
  });
});

describe("the lead's time zone", () => {
  it("reads HubSpot's zone, then the country", () => {
    expect(fromHubSpotTimezone("america_slash_new_york")).toBe(
      "America/New_York",
    );
    expect(fromHubSpotTimezone("europe_slash_london")).toBe("Europe/London");
    expect(fromHubSpotTimezone("not_a_zone")).toBeNull();
    expect(leadTimezone({ country: "Germany" })).toBe("Europe/Berlin");
    expect(
      leadTimezone({ hubspotTimezone: "asia_slash_tokyo", country: "Germany" }),
    ).toBe("Asia/Tokyo");
    expect(leadTimezone({ country: "Atlantis" })).toBeNull();
  });
});
