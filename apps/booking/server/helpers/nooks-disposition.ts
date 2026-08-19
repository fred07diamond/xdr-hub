// The one, shared definition of "this Nooks call disposition counts as a
// booked meeting" -- used by nooks-webhook.post.ts (deciding whether to
// auto-create a pending meeting) and capture-nooks-transcript.ts (deciding
// whether to accept a transcript from the extension). Keep these in sync by
// only ever importing this, never redefining the pattern inline.
export const CONNECTED_MEETING_RE = /connected[\s_-]*meeting|meeting[\s_-]*(booked|set|scheduled)/i;

export function isConnectedMeetingDisposition(disposition: string | null | undefined): boolean {
  return !!disposition && CONNECTED_MEETING_RE.test(disposition);
}
