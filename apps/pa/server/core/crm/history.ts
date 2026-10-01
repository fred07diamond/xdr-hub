// Contact history from HubSpot (D64): the emails, calls, meetings, and notes
// on a contact, read-only, newest first. Shown on the lead so a PA sees what
// was already sent, and used to mark the first touch when someone replied
// from HubSpot instead of from PA. Email bodies are the lead's and the rep's
// text: data, never instructions.
import type { HubSpotFetch } from "./hubspot-adapter.js";

export type HistoryKind = "email" | "call" | "meeting" | "note" | "dobby";

export interface HistoryItem {
  id: string;
  kind: HistoryKind;
  /** outbound: from our side; inbound: from the lead. */
  direction: "outbound" | "inbound" | null;
  at: string | null;
  title: string | null;
  preview: string | null;
  from: string | null;
  to: string | null;
  status: string | null;
}

export interface ContactHistory {
  items: HistoryItem[];
  /**
   * The first email we sent after the form, found among every email on the
   * contact, not only the newest ones shown (D68). Set when asked for.
   */
  firstTouch?: HistoryItem | null;
  /** Kinds HubSpot would not return, for example a token without the email scope. */
  unavailable: Array<{ kind: HistoryKind; reason: string }>;
}

const TYPES: Array<{
  kind: Exclude<HistoryKind, "dobby">;
  object: string;
  properties: string[];
}> = [
  {
    kind: "email",
    object: "emails",
    properties: [
      "hs_timestamp",
      "hs_email_direction",
      "hs_email_subject",
      "hs_email_text",
      "hs_body_preview",
      "hs_email_status",
      "hs_email_from_email",
      "hs_email_to_email",
    ],
  },
  {
    kind: "call",
    object: "calls",
    properties: [
      "hs_timestamp",
      "hs_call_title",
      "hs_call_body",
      "hs_call_direction",
      "hs_call_disposition",
    ],
  },
  {
    kind: "meeting",
    object: "meetings",
    properties: [
      "hs_timestamp",
      "hs_meeting_title",
      "hs_meeting_body",
      "hs_meeting_outcome",
      "hs_meeting_start_time",
    ],
  },
  {
    kind: "note",
    object: "notes",
    properties: ["hs_timestamp", "hs_note_body"],
  },
];

const clean = (value: unknown, max = 600) => {
  if (typeof value !== "string") return null;
  const text = value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
};

const ENTITIES: Record<string, string> = {
  "&nbsp;": " ",
  "&amp;": "&",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&lt;": "<",
  "&gt;": ">",
};

/**
 * An email body as readable plain text: paragraphs kept, HTML and entities
 * gone, a link written twice ("url: url") once, and the quoted reply chain
 * dropped so only the new message shows.
 */
export function cleanBody(value: unknown, max = 4000): string | null {
  if (typeof value !== "string") return null;
  let text = value
    .replace(/\r\n?/g, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(nbsp|amp|quot|#39|apos|lt|gt);/g,
      (entity) => ENTITIES[entity] ?? entity,
    );
  // The reply chain: "On Tue, Sep 30, ... wrote:" and everything after it.
  text = text.split(/\n\s*On .{4,120}wrote:\s*\n/)[0];
  text = text.split(/\n-{2,}\s*Original Message\s*-{2,}/i)[0];
  // A link HubSpot renders as its text and its href.
  text = text.replace(/(https?:\/\/\S+?)[:\s]+\1/g, "$1");
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}...` : text;
}

function toItem(
  kind: Exclude<HistoryKind, "dobby">,
  raw: { id: string; properties: Record<string, unknown> },
): HistoryItem {
  const p = raw.properties;
  const at = clean(p.hs_timestamp ?? p.hs_meeting_start_time, 40);
  if (kind === "email") {
    const direction = String(p.hs_email_direction ?? "");
    return {
      id: `email:${raw.id}`,
      kind,
      direction: direction === "INCOMING_EMAIL" ? "inbound" : "outbound",
      at,
      title: clean(p.hs_email_subject, 200),
      preview: cleanBody(p.hs_email_text ?? p.hs_body_preview),
      from: clean(p.hs_email_from_email, 200),
      to: clean(p.hs_email_to_email, 400),
      status: clean(p.hs_email_status, 40),
    };
  }
  if (kind === "call")
    return {
      id: `call:${raw.id}`,
      kind,
      direction:
        String(p.hs_call_direction ?? "") === "INBOUND"
          ? "inbound"
          : "outbound",
      at,
      title: clean(p.hs_call_title, 200),
      preview: cleanBody(p.hs_call_body, 1500),
      from: null,
      to: null,
      status: clean(p.hs_call_disposition, 60),
    };
  if (kind === "meeting")
    return {
      id: `meeting:${raw.id}`,
      kind,
      direction: null,
      at,
      title: clean(p.hs_meeting_title, 200),
      preview: cleanBody(p.hs_meeting_body, 1500),
      from: null,
      to: null,
      status: clean(p.hs_meeting_outcome, 60),
    };
  return {
    id: `note:${raw.id}`,
    kind,
    direction: null,
    at,
    title: null,
    preview: cleanBody(p.hs_note_body, 1500),
    from: null,
    to: null,
    status: null,
  };
}

/** Every associated id, following HubSpot's paging (bounded). */
async function associatedIds(
  fetch: HubSpotFetch,
  contactId: string,
  object: string,
  max = 1000,
): Promise<string[]> {
  const ids: string[] = [];
  let after: string | null = null;
  do {
    const page = (await fetch(
      `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/${object}?limit=500${after ? `&after=${encodeURIComponent(after)}` : ""}`,
    )) as {
      results?: Array<{ toObjectId: string | number }>;
      paging?: { next?: { after?: string } };
    };
    ids.push(...(page.results ?? []).map((item) => String(item.toObjectId)));
    after = page.paging?.next?.after ?? null;
  } while (after && ids.length < max);
  return ids;
}

async function batchRead(
  fetch: HubSpotFetch,
  object: string,
  properties: string[],
  ids: string[],
) {
  const rows: Array<{ id: string; properties: Record<string, unknown> }> = [];
  for (let index = 0; index < ids.length; index += 100) {
    const batch = (await fetch(`/crm/v3/objects/${object}/batch/read`, {
      method: "POST",
      body: JSON.stringify({
        properties,
        inputs: ids.slice(index, index + 100).map((id) => ({ id })),
      }),
    })) as {
      results?: Array<{ id: string; properties: Record<string, unknown> }>;
    };
    rows.push(...(batch.results ?? []));
  }
  return rows;
}

export async function fetchContactHistory(
  fetch: HubSpotFetch,
  contactId: string,
  options: { perType?: number; firstTouchSince?: string | null } = {},
): Promise<ContactHistory> {
  const perType = options.perType ?? 20;
  const items: HistoryItem[] = [];
  const unavailable: ContactHistory["unavailable"] = [];
  let firstTouch: HistoryItem | null = null;
  await Promise.all(
    TYPES.map(async (type) => {
      try {
        const ids = await associatedIds(fetch, contactId, type.object);
        if (ids.length === 0) return;
        // Emails are read in full so the first touch is the real first one;
        // other kinds only need the newest.
        const wanted =
          type.kind === "email" && options.firstTouchSince
            ? ids
            : ids.slice(-perType * 3);
        const read = (
          await batchRead(fetch, type.object, type.properties, wanted)
        ).map((raw) => toItem(type.kind, raw));
        read.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
        if (type.kind === "email" && options.firstTouchSince)
          firstTouch = firstTouchAfter(
            { items: read, unavailable: [] },
            options.firstTouchSince,
          );
        items.push(...read.slice(0, perType));
      } catch (error) {
        unavailable.push({
          kind: type.kind,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  );
  try {
    const contact = (await fetch(
      `/crm/v3/objects/contacts/${encodeURIComponent(contactId)}?properties=dobby_message_1`,
    )) as { properties?: Record<string, unknown> };
    const dobby = cleanBody(contact.properties?.dobby_message_1, 2000);
    if (dobby)
      items.push({
        id: "dobby",
        kind: "dobby",
        direction: "outbound",
        at: null,
        title: "Dobby's Contact Sales message",
        preview: dobby,
        from: "Dobby",
        to: null,
        status: null,
      });
  } catch {
    // The Dobby property is optional.
  }
  items.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  return options.firstTouchSince !== undefined
    ? { items, unavailable, firstTouch }
    : { items, unavailable };
}

/** The first email we sent after the form: HubSpot's own first touch. */
export function firstTouchAfter(
  history: ContactHistory,
  submittedAt: string,
): HistoryItem | null {
  const since = Date.parse(submittedAt);
  const sent = history.items
    .filter(
      (item) =>
        item.kind === "email" &&
        item.direction === "outbound" &&
        item.at &&
        Date.parse(item.at) >= since &&
        !/fail|bounce|draft|scheduled/i.test(item.status ?? ""),
    )
    .sort((a, b) => (a.at ?? "").localeCompare(b.at ?? ""));
  return sent[0] ?? null;
}
