import { defineEventHandler, getRequestURL } from "h3";
import { runLeadPipelineSweepTick } from "../helpers/lead-pipeline-sweep.js";

// li-agent has no cron/background-job primitive of its own, and the
// framework's background-function support is hardcoded to 3 internal paths
// apps can't hook into. This middleware instead piggybacks on a real,
// already-existing trigger: the framework's own Netlify Scheduled Function
// (`agent-native-keep-warm`, `* * * * *`) pings `/_agent-native/health` every
// 60s forever, regardless of any visitor.
//
// Deliberately scoped to ONLY that health-check path, not every request:
// the sweep tick is AWAITED (not fired-and-forgotten after a response --
// that pattern can be killed mid-flight by the serverless runtime), which
// adds real latency to whichever request carries it. Nobody is waiting on
// the health check's response, so it can safely absorb that; a real xDR
// loading a page must never be the one who eats it.
//
// Known soft dependency: if a future framework version removes or renames
// the keep-warm function/health path, this sweep simply stops advancing
// (silent degradation, not a crash) until that's noticed and re-pointed.
const HEALTH_CHECK_PATH = "/_agent-native/health";
const SWEEP_MIN_INTERVAL_MS = 45_000;
let lastRunAt = 0;

export default defineEventHandler(async (event) => {
  if (getRequestURL(event).pathname !== HEALTH_CHECK_PATH) return;

  const now = Date.now();
  if (now - lastRunAt < SWEEP_MIN_INTERVAL_MS) return;
  lastRunAt = now;
  await runLeadPipelineSweepTick();
});
