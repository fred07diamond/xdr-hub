// Reading what came back after a first touch (D103): an out-of-office reply
// pauses a cadence instead of ending it, a bounce ends it, and anything else
// from the lead is a real reply. Pure functions over HubSpot's email history.

export interface InboundEmail {
  id: string;
  at: string | null;
  title: string | null;
  preview: string | null;
  from: string | null;
  direction: "inbound" | "outbound" | null;
  status: string | null;
}

const OOO =
  /\b(out of (the )?office|ooo\b|automatic reply|auto[- ]?reply|autoreply|away from (the )?office|on (annual |parental |maternity |paternity )?leave|on vacation|on holiday|currently away|limited access to (my )?email|abwesenheit|absence|fuera de la oficina)\b/i;

export function isOutOfOffice(email: Pick<InboundEmail, "title" | "preview">) {
  return OOO.test(`${email.title ?? ""}\n${email.preview ?? ""}`);
}

const BOUNCE_SUBJECT =
  /\b(undeliverable|delivery status notification|delivery has failed|mail delivery (failed|subsystem)|returned mail|message not delivered|address not found|failure notice)\b/i;
const BOUNCE_SENDER = /\b(mailer-daemon|postmaster)\b/i;

export function isBounce(email: InboundEmail) {
  if (email.direction === "outbound")
    return /^(bounced|failed)$/i.test(email.status ?? "");
  return (
    BOUNCE_SENDER.test(email.from ?? "") ||
    BOUNCE_SUBJECT.test(email.title ?? "")
  );
}

const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];

/**
 * The date an out-of-office says they are back, when it names one ("back on
 * October 12", "until 12 Oct", "returning 10/12"). The year is the next one
 * that makes the date in the future. Null when no date is found.
 */
export function returnDateOf(text: string, now: Date): Date | null {
  const lower = text.toLowerCase();
  const candidates: Array<{ month: number; day: number }> = [];
  const month =
    "(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\\.?";
  for (const match of lower.matchAll(
    new RegExp(`\\b${month}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, "g"),
  ))
    candidates.push({
      month: MONTHS.indexOf(match[1].slice(0, 3)),
      day: Number(match[2]),
    });
  for (const match of lower.matchAll(
    new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?${month}`, "g"),
  ))
    candidates.push({
      month: MONTHS.indexOf(match[2].slice(0, 3)),
      day: Number(match[1]),
    });
  for (const match of lower.matchAll(/\b(\d{1,2})\/(\d{1,2})(?:\/\d{2,4})?\b/g))
    candidates.push({ month: Number(match[1]) - 1, day: Number(match[2]) });
  const valid = candidates.filter(
    (item) =>
      item.month >= 0 && item.month < 12 && item.day >= 1 && item.day <= 31,
  );
  if (valid.length === 0) return null;
  // The latest upcoming date mentioned is the return date ("from Oct 1 to
  // Oct 12"). A date months in the past means next year ("back Jan 3").
  const dates = valid.map((item) => {
    const date = new Date(
      Date.UTC(now.getUTCFullYear(), item.month, item.day, 16),
    );
    if (date.getTime() < now.getTime() - 60 * 86_400_000)
      date.setUTCFullYear(date.getUTCFullYear() + 1);
    return date;
  });
  const upcoming = dates.filter(
    (date) => date.getTime() >= now.getTime() - 86_400_000,
  );
  if (upcoming.length === 0) return null;
  const latest = upcoming.sort((a, b) => b.getTime() - a.getTime())[0];
  // An out-of-office longer than two months is more likely a misread.
  return latest.getTime() - now.getTime() > 62 * 86_400_000 ? null : latest;
}

export type ReplySignal =
  | { kind: "reply"; email: InboundEmail }
  | { kind: "out_of_office"; email: InboundEmail; until: Date }
  | { kind: "bounce"; email: InboundEmail }
  | { kind: "meeting"; at: string };

/** Five business days, when an out-of-office names no date. */
export function defaultReturn(now: Date): Date {
  const date = new Date(now);
  let added = 0;
  while (added < 5) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6) added += 1;
  }
  return date;
}

/**
 * The first thing after the first touch that changes the cadence, skipping
 * out-of-office emails already handled. Bounces and meetings win over
 * replies; a real reply wins over an out-of-office.
 */
export function signalSince(input: {
  since: string;
  emails: InboundEmail[];
  meetings: Array<{ at: string | null }>;
  handled: Set<string>;
  now: Date;
}): ReplySignal | null {
  const after = (at: string | null) => Boolean(at && at > input.since);
  const fresh = input.emails.filter(
    (email) => after(email.at) && !input.handled.has(email.id),
  );
  const bounce = fresh.find(isBounce);
  if (bounce) return { kind: "bounce", email: bounce };
  const meeting = input.meetings.find((item) => after(item.at));
  if (meeting?.at) return { kind: "meeting", at: meeting.at };
  const inbound = fresh.filter((email) => email.direction === "inbound");
  const reply = inbound.find((email) => !isOutOfOffice(email));
  if (reply) return { kind: "reply", email: reply };
  const away = inbound.find(isOutOfOffice);
  if (away)
    return {
      kind: "out_of_office",
      email: away,
      until:
        returnDateOf(`${away.title ?? ""}\n${away.preview ?? ""}`, input.now) ??
        defaultReturn(input.now),
    };
  return null;
}
