// The minute poll (D58): a Netlify scheduled function calls this route every
// minute. It pulls new Contact Sales submissions from HubSpot (read-only),
// wakes the inbound agent when there is new work, and checks decision
// deadlines. A route, not an action, because it authenticates by signature
// instead of a session.
import { runWithRequestContext } from "@agent-native/core/server";
import { defineEventHandler, getHeader, setResponseStatus } from "h3";

import { getOwnerCtx } from "../../../lib/owner-context.js";
import { verifyPoll } from "../../../lib/poll-signature.js";
import { runInboundSweep } from "../../../lib/sweep.js";

export default defineEventHandler(async (event) => {
  const ok = verifyPoll({
    // guard:allow-env-credential — the workspace's shared A2A signing secret, verified here, never returned
    secret: process.env.A2A_SECRET,
    timestamp: getHeader(event, "x-pa-timestamp"),
    signature: getHeader(event, "x-pa-signature"),
    now: Date.now(),
  });
  if (!ok) {
    setResponseStatus(event, 401);
    return { error: "Bad signature" };
  }
  const owner = await getOwnerCtx();
  if (!owner) {
    setResponseStatus(event, 503);
    return { error: "WORKSPACE_OWNER_EMAIL is not set" };
  }
  try {
    return await runWithRequestContext(owner, () => runInboundSweep(owner));
  } catch (error) {
    console.error("[pa] Minute poll failed:", error);
    setResponseStatus(event, 500);
    return { error: error instanceof Error ? error.message : String(error) };
  }
});
