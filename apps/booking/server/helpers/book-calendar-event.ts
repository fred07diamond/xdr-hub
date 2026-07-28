// Calls the Agent Native Calendar app via its HTTP API.
// Prereq: Calendar app running locally (e.g. http://localhost:8081/calendar).
// Set CALENDAR_APP_URL in .env to point to the running Calendar app.
// Set AGENT_NATIVE_TOKEN if the Calendar app requires auth (omit for local dev).

export async function bookCalendarEvent({
  title,
  datetime,
  prospectEmail,
  aeEmail,
  xdrEmail,
  description,
}: {
  title: string;
  datetime: string;
  prospectEmail?: string;
  aeEmail: string;
  xdrEmail: string;
  description: string;
}): Promise<{ eventId: string; meetingLink: string }> {
  const calendarUrl = process.env.CALENDAR_APP_URL ?? "http://localhost:8081/calendar";
  const agentNativeToken = process.env.AGENT_NATIVE_TOKEN;

  // Call the Calendar app's create-event action via HTTP API.
  // The action schema (title, start) matches the Calendar app template's CLI interface.
  // If the Calendar app's create-event supports additional fields (attendees, conferencing),
  // add them to the body below after inspecting the Calendar app's action source.
  const res = await fetch(`${calendarUrl}/_agent-native/actions/create-event`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(agentNativeToken ? { Authorization: `Bearer ${agentNativeToken}` } : {}),
    },
    body: JSON.stringify({
      title,
      start: datetime,
      // Include attendees if the Calendar app's create-event action supports them:
      attendees: [aeEmail, xdrEmail, ...(prospectEmail ? [prospectEmail] : [])],
      description,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Calendar booking failed (${res.status}): ${body.slice(0, 200)}`);
  }

  const data = (await res.json()) as { eventId?: string; meetingLink?: string; id?: string; hangoutLink?: string };
  return {
    eventId: data.eventId ?? data.id ?? "",
    meetingLink: data.meetingLink ?? data.hangoutLink ?? "",
  };
}
