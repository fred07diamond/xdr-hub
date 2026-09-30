// PA's minute poll (apps/pa D58): Netlify runs this every minute and makes a
// signed call to PA, which pulls new Contact Sales leads from HubSpot
// (read-only), wakes the inbound agent, and checks decision deadlines.
// No model call and no dependencies: a signature and one request.
import crypto from "node:crypto";

export default async () => {
  const secret = process.env.A2A_SECRET;
  const base = process.env.URL;
  if (!secret || !base) {
    console.error("[pa-intake-poll] A2A_SECRET or URL is not set");
    return;
  }
  const timestamp = String(Date.now());
  const signature = crypto
    .createHmac("sha256", secret)
    .update(`pa-intake-poll.${timestamp}`)
    .digest("hex");
  const response = await fetch(`${base}/pa/api/internal/intake-poll`, {
    method: "POST",
    headers: { "x-pa-timestamp": timestamp, "x-pa-signature": signature },
  });
  const body = await response.text();
  if (!response.ok)
    console.error(`[pa-intake-poll] ${response.status}: ${body.slice(0, 500)}`);
  else console.log(`[pa-intake-poll] ${body.slice(0, 500)}`);
};

export const config = { schedule: "* * * * *" };
