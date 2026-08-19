import { defineEventHandler } from "h3";
import { runLeadPipelineSweepTick } from "../helpers/lead-pipeline-sweep.js";

// li-agent has no cron/background-job primitive of its own. The original
// version of this middleware piggybacked on a Netlify Scheduled Function
// (`agent-native-keep-warm`) that pings `/_agent-native/health` every 60s --
// live-confirmed via `searchSiteFunctions` that this is a SINGLE-APP-ONLY
// mechanism (`emitSingleTemplateNetlifyKeepWarmFunction` is never called
// from `workspace-deploy.js`, the path this multi-app repo actually
// builds through). That function does not exist in this deployment, so
// the sweep never fired at all -- confirmed live: leads sat unenriched
// with zero progress.
//
// This app DOES have its own always-scheduled function
// (`li-agent-agent-recurring-jobs`, "* * * * *"), but it's the agent-loop
// job runner (executes natural-language job instructions), not a bare
// code hook -- not the right fit for deterministic per-lead processing.
//
// Fix: run the sweep opportunistically on real incoming requests instead.
// Every request that reaches this app's server function -- any page load,
// any action call, any of the Lead Lists/Prospects pages' own periodic
// refetches -- checks this debounce and, at most once every
// SWEEP_MIN_INTERVAL_MS, awaits one small batch of the pipeline before
// continuing. Kept deliberately small (see BATCH_SIZE/TICK_BUDGET_MS in
// lead-pipeline-sweep.ts) so it can never meaningfully delay whichever
// request happens to carry it.
//
// Known real gap: with the app fully idle (zero traffic, nobody's tab
// open), nothing advances. Closing that gap for real needs either a
// registered recurring job (via the Agent page's Jobs tab, or the
// `manage-jobs` action) whose instructions call `run-lead-pipeline-sweep`,
// or Dispatch's Automations once that's usable again -- deliberately not
// built here without confirming which the user wants.
const SWEEP_MIN_INTERVAL_MS = 10_000;
let lastRunAt = 0;

export default defineEventHandler(async () => {
  const now = Date.now();
  if (now - lastRunAt < SWEEP_MIN_INTERVAL_MS) return;
  lastRunAt = now;
  await runLeadPipelineSweepTick();
});
