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
      preview: clean(p.hs_email_text ?? p.hs_body_preview),
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
      preview: clean(p.hs_call_body),
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
      preview: clean(p.hs_meeting_body),
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
    preview: clean(p.hs_note_body),
    from: null,
    to: null,
    status: null,
  };
}

export async function fetchContactHistory(
  fetch: HubSpotFetch,
  contactId: string,
  options: { perType?: number } = {},
): Promise<ContactHistory> {
  const perType = options.perType ?? 20;
  const items: HistoryItem[] = [];
  const unavailable: ContactHistory["unavailable"] = [];
  await Promise.all(
    TYPES.map(async (type) => {
      try {
        const associated = (await fetch(
          `/crm/v4/objects/contacts/${encodeURIComponent(contactId)}/associations/${type.object}?limit=100`,
        )) as { results?: Array<{ toObjectId: string | number }> };
        const ids = (associated.results ?? [])
          .map((item) => String(item.toObjectId))
          .slice(-perType * 3);
        if (ids.length === 0) return;
        const batch = (await fetch(
          `/crm/v3/objects/${type.object}/batch/read`,
          {
            method: "POST",
            body: JSON.stringify({
              properties: type.properties,
              inputs: ids.map((id) => ({ id })),
            }),
          },
        )) as {
          results?: Array<{ id: string; properties: Record<string, unknown> }>;
        };
        const read = (batch.results ?? []).map((raw) => toItem(type.kind, raw));
        read.sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
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
    const dobby = clean(contact.properties?.dobby_message_1, 1200);
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
  return { items, unavailable };
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
