// Sends the follow-up email from the XDR's Gmail account.
// Uses the Gmail API with an OAuth access token.
// The XDR must have connected their Google account via /_agent-native/connections/oauth/google/

const GMAIL_API_BASE = "https://gmail.googleapis.com";

function makeEmailMessage({
  fromEmail,
  toEmail,
  ccEmail,
  subject,
  body,
}: {
  fromEmail: string;
  toEmail: string;
  ccEmail?: string;
  subject: string;
  body: string;
}): string {
  const lines = [
    `From: ${fromEmail}`,
    `To: ${toEmail}`,
    ...(ccEmail ? [`Cc: ${ccEmail}`] : []),
    `Subject: ${subject}`,
    `Content-Type: text/plain; charset=utf-8`,
    ``,
    body,
  ];
  const raw = lines.join("\r\n");
  // Base64 URL-encode
  return Buffer.from(raw, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function sendFollowupEmail({
  xdrEmail,
  prospectEmail,
  aeEmail,
  subject,
  body,
  accessToken,
}: {
  xdrEmail: string;
  prospectEmail: string;
  aeEmail: string;
  subject: string;
  body: string;
  accessToken: string;
}): Promise<{ messageId: string }> {
  const safeSubject = subject.replace(/[\r\n]/g, " ");
  const raw = makeEmailMessage({
    fromEmail: xdrEmail,
    toEmail: prospectEmail,
    ccEmail: aeEmail,
    subject: safeSubject,
    body,
  });

  const res = await fetch(
    `${GMAIL_API_BASE}/gmail/v1/users/me/messages/send`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ raw }),
    }
  );

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Gmail send failed (${res.status}): ${err.slice(0, 200)}`);
  }

  const data = (await res.json()) as { id?: string };
  return { messageId: data.id ?? "" };
}
