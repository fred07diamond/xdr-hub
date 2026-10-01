# Decisions

Settled calls, each with the why and the why-not. Add new decisions at the
bottom. Revisit one only when its "revisit when" condition happens.

## D1. A fresh workspace on the current framework

- **Status:** Superseded by D33 (Fred, 2026-09-29). Kept for the record.
- **Choice:** new Agent-Native workspace `pa-hub` on `@agent-native/core`
  0.197.0, with the PA app at `apps/pa`.
- **Why:** xDR Hub is pinned to 0.176.4, which lacks the recurring sweep hook
  this design relies on (D11). Upgrading xDR Hub first would put Builder.LI
  and the other live apps at risk before any PA work starts. A clean
  workspace also avoids inheriting xDR Hub's duplicated people tables and
  split API clients.
- **Why not add the app to xDR Hub:** one front door is right long term, but
  the upgrade and its regressions come first on that path. The xDR Hub apps
  can link to PA over A2A, and move into `pa-hub` later.
- **Longer term:** `pa-hub` is the home. xDR Hub apps link to it over A2A
  and move in one at a time after they are upgraded.

## D2. One PA app, foundations inside it for now

- **Choice:** later PA tools are modules inside `apps/pa`, sharing one
  object model. Foundations live in `apps/pa/server/core`.
- **Why:** the IA calls for one app with many surfaces. The framework's
  workspace convention puts code in `packages/shared` only once two apps need
  it.
- **Revisit when:** a second app needs a foundation module. Lift it into a
  package then, without changing its contract.

## D3. Deterministic pipeline, bounded agent steps

- **Choice:** code runs normalize, CRM snapshot, pre-check, route, score, and
  notify. The agent runs only message assessment and drafting, through the
  framework's agent. Default path: the server-side agent loop from the
  processor. Alternative: event automations.
- **Why:** rules and lookups are cheaper, faster, and testable as code. The
  framework forbids inline LLM calls.
- **To verify at scaffold:** read `integration-webhooks`, `agent-surfaces`,
  `processors`, and `automations`, then record the final path here.

## D4. Intake follows the framework's webhook pattern

- **Choice:** verify, store once in `pa_inbox`, return 200, fire a signed self
  POST to the processor, and let the sweep retry stuck work up to 3 times.
- **Why:** HubSpot and Slack time out quickly, and fire-and-forget promises
  die on serverless hosts. This is the pattern the framework's own
  integrations use.
- **Why not Netlify background functions directly:** they don't port to other
  hosts, and the framework already provides the pattern.

## D5. HubSpot ingestion through a workflow webhook

- **Choice:** a HubSpot workflow on Contact Sales submission with "Send a
  webhook," authenticated by request signature, plus a polling backstop.
- **Why:** it fires exactly on the event we care about and needs no app
  install in the portal.
- **Why not app webhooks first:** they are property-change based and noisier
  for this event. They remain the fallback if the plan lacks Data Hub
  Professional or Enterprise.
- **Open:** confirm Builder's HubSpot plan in M0.

## D6. A separate Slack app for inbound cards

- **Choice:** a "PA Inbound" Slack app with its own interactivity route.
- **Why:** in 0.197.0, the framework's Slack interactions route handles only
  its own approve, deny, and cancel controls, and a Slack app has a single
  interactivity URL.
- **Revisit when:** the framework supports custom block actions.

## D7. No sends until M2, and never auto-send

- **Choice:** M0 and M1 never send or write. M2 sends through
  `needsApproval` and the outbox, and logs to HubSpot.
- **Why:** trust is earned from measured behavior, and the outbox makes
  retries safe.

## D8. Table naming and migrations

- **Choice:** every table is prefixed `pa_`; migrations run through
  `runMigrations` with the name `pa`; changes are additive only; no
  `drizzle-kit push` against production.
- **Why:** workspace apps share one database by default.

## D9. Playbook v1 is versioned YAML compiled into releases

- **Status:** Superseded by D44 (2026-09-30). The YAML is the seed only; the playbook is edited in the app.

- **Choice:** entries live in the repo, compile into immutable releases
  (content hash), and are pinned per engagement. Rules are evaluated in code.
- **Why:** it gives version control, review, and receipts from day one. The
  editor UI comes after M3.

## D10. Models are configuration

- **Choice:** Haiku 4.5 for assessment and Sonnet 5.5 for drafting by
  default, set as configuration, with no sampling parameters.
- **Why:** some current models reject non-default `temperature`, `top_p`, and
  `top_k`, and model choice will change.
- **Revisit when:** evals show a cheaper or stronger model is better.

## D11. The durable sweep uses the framework's recurring sweep hook

- **Status:** Superseded by D34. The hook does not exist in 0.176.4.

- **Choice:** register one handler, `pa-sweep`, with
  `registerRecurringSweepHandler` from `@agent-native/core/server`. It
  handles clocks, retries, outbox dispatch, and the backstop poll within the
  90 second budget.
- **Why:** on Netlify, the framework already emits the per-minute scheduled
  trigger that drives this hook.
- **Risk:** the hook is exported but not documented. Verify it at scaffold.
  Fallback: a Netlify scheduled function calling an HMAC-signed internal
  route. Scheduled functions have a 30 second limit and run only on published
  deploys, so keep each run small.

## D12. Modes through feature flags

- **Choice:** shadow is the default; live is on for an allowlist of design
  partners, then for everyone, using the framework's feature flags.
- **Why:** modes switch without a deploy, and every evaluation is recorded.

## D13. No paid enrichment in slice 1

- **Choice:** show unknown roles as unknown. Paid enrichment is a later,
  budgeted gateway capability.
- **Why:** cost control, and the pre-check doesn't need it.

## D14. Personal data

- **Choice:** synthetic fixtures, minimal logs, and 90-day retention on raw
  payloads (proposed).
- **Why:** labeled sets and prompts are where personal data leaks.

## D15. The Contact Sales fast lane's auto-send is deferred

- **Choice:** step 1d's auto-send is not built in this slice. It becomes an
  earned grant decided from M2 data.
- **Why:** it contradicts the rep-approves-everything rule elsewhere in the
  docs. Data should settle that, not a default.

## D16. Build in the Builder container

- **Status:** Superseded by D33. PA now builds and runs in the xDR Hub workspace.

- **Choice:** the workspace is built and previewed in the Builder cloud
  container (Node 22.23.2, pnpm 10.29.1, native build tools present). The
  preview installs with pnpm and runs the root dev script on port 8080,
  which is the workspace gateway.
- **Why:** Fred's call on 2026-09-29. The container meets the framework's
  Node floor, so no local machine is needed for M0.

## D17. Scaffold flag drift and the /tmp move

- **Status:** Superseded by D33. `apps/pa` was re-scaffolded in xDR Hub with `add-app pa --template=chat`, and this build's code was ported into it (D40).

- **Choice:** scaffolded with `create pa-hub --template dispatch,chat` in
  `/tmp`, exported with `git archive` into the repo root (the project's Git
  history kept), then `add-app pa --template=chat`. Dispatch and Chat stay
  until Fred decides.
- **Why:** a non-interactive `--template chat` makes a standalone app; a
  workspace needs two or more templates and Dispatch is always included.
  `create` in place needs an empty folder. The dev script sets
  `WORKSPACE_DEFAULT_APP=pa` and `WORKSPACE_NO_OPEN=1` (the container has no
  `xdg-open`).

## D18. Framework assumption results (D3, D6, D11, skill scopes)

- **Status:** Superseded by D38. These results were for 0.197.0; on 0.176.4 the sweep hook is absent (D34).

- **Result:** checked in the installed 0.197.0 types and source.
  `registerRecurringSweepHandler` is exported with a 90 second budget (D11
  holds). `runAgentLoop` is exported for server-side agent steps (input to
  D3; the path is chosen in M1). The built-in `/slack/interactions` route
  handles only the framework's approve, deny, and cancel actions (D6 holds).
  Skill `scope: runtime` and `scope: dev` are valid.

## D19. The integration-webhooks skill is absent

- **Status:** Superseded. xDR Hub ships the `integration-webhooks` skill (in `packages/shared/.agents/skills`), so D4 follows it.

- **Choice:** build intake from `server-routes` (h3 `readRawBody`),
  `durable-background-runs`, and `security`.
- **Why:** the skill cited from the xDR Hub copy is not shipped in 0.197.0.

## D20. Assess before pre-check

- **Choice:** the step order is normalize, crm_snapshot, assess_message,
  precheck, route, score, draft, notify. assess_message always runs.
- **Why:** Fred's call. Pre-check signals such as student, vendor, and
  support come from the message, and attached leads still need their new ask
  shown to the owner.

## D21. Pre-check evaluation order and open items

- **Choice:** the compliance tier (`rule.precheck.restricted_countries`)
  runs first, then the `rule.precheck.outcomes` params in declared order.
  Signals with no playbook outcome (undeliverable email) and params with no
  definition (the `active_conversation` threshold, `open_work_policy`) are
  recorded as open items on the receipt and never guessed.
- **Why:** a guessed rule would silently route real leads. Open items show
  on the record until RevOps and Fred define them.

## D22. Early M1 board preview over synthetic data

- **Choice:** this first pass opens to the M1 inbound board and engagement
  record, fed by replaying the seven synthetic cases in shadow mode.
- **Why:** Fred's call, so the team can react to the working surface early.
  The M1 gate still governs live traffic: no intake, sends, CRM writes, or
  model calls exist yet.

## D23. Clocks only with a human owner

- **Choice:** `rule.sla.first_touch` and `rule.sla.decision` run only on
  engagements with a human owner, in the owner's working hours. Settled
  outcomes (support, disqualified, closed) show "No clock" with the reason.
  An attached SAL lead gets a first-touch clock but no QL decision clock.
- **Why:** a clock nobody owns cannot be met, and breach counts would be
  noise.

## D24. Build-time playbook compile

- **Status:** Narrowed by D44. The compile still builds the seed release, which the demo and tests use and the database imports once; runtime reads the active release from the database.

- **Choice:** `pnpm playbook:compile` turns the playbook and config YAML into
  `server/generated/playbook-release.json` with a SHA-256 content-hash id.
  Runtime imports the JSON and never reads files; `--check` fails when the
  artifact is stale. Adds the `yaml` package.
- **Why:** serverless bundles cannot rely on reading YAML at runtime, and a
  content hash makes every receipt cite an exact release.

## D25. The /settings collision

- **Choice:** the framework owns `/settings`. PA's left nav links to it, and
  PA-specific settings (mode flag, routing pool) get a PA section or route in
  M1.
- **Why:** shadowing a framework route breaks its account, agent, and
  workspace pages.

## D26. The injection flag is a guardrail, not a rule

- **Choice:** injection-pattern detection lives in `server/core/untrusted`.
  It flags the engagement for review and never changes pre-check, route, or
  verdict. Form text is shown as inert text in the UI and wrapped in
  delimiters for agent and CLI callers; it never becomes a recipient, link,
  or instruction.
- **Why:** security behavior must not depend on playbook edits.

## D27. agent-native.json merge

- **Choice:** the seed `onboarding.firstRun` block is merged with the
  template's `doctor.failOnBuild: false`, not overwritten.
- **Why:** the merge-not-overwrite rule; both keys are valid in 0.197.0.

## D28. Migration table option

- **Choice:** PA migrations use `runMigrations([...], { table:
"pa_migrations" })`.
- **Why:** the installed 0.197.0 types take `table`, not the `name` option
  the plan assumed.

## D29. Framework dev issues worked around in app config

- **Status:** Not ported. Both workarounds target 0.197.0 dev behavior; the xDR Hub scaffold on 0.176.4 does not use AgentKit or this optimizeDeps setup, and `pnpm eval` is kept.

- **Agent panel crash:** in dev, 0.197.0 pre-bundles
  `@agent-native/agentkit/react/context` but its sidebar imports
  `@agent-native/agentkit/react` unbundled, so two AgentKit contexts exist
  and the panel shows "Agent panel hit a glitch". The untouched Chat app
  crashes the same way. Fixed for PA with `optimizeDeps.include:
["@agent-native/agentkit/react"]` in `apps/pa/vite.config.ts`. Chat is
  left as scaffolded.
- **Eval CLI:** `agent-native eval` loads `*.eval.ts` with Node type
  stripping, which does not resolve the codebase's `.js` import specifiers.
  `pnpm eval` runs the same `runEvalSuite` API under `tsx` with a runner that
  refuses agent calls until M1.
- **Local gateway access:** through the workspace gateway, PA actions failed
  closed ("Workspace app access is temporarily unavailable"). Superseded by
  D32: `A2A_SECRET` alone would not fix it.
- **Why:** app-level configuration only. Both issues should be reported
  upstream. D32 later adds one pinned framework patch.

## D30. pa\_ tables are team-shared (doctor db-tool-scoping)

- **Choice (pending Fred's review):** all 17 `pa_` tables are listed in
  `apps/pa/agent-native.json` `doctor.dbToolScopingDenylist` instead of
  getting `owner_email` or `org_id` columns.
- **Why:** the inbound queue belongs to one PA team, not to individual users,
  and the PA agent runs with `frameworkTools.database: "off"`, so it has no
  raw SQL tool to misuse. If PA Hub ever serves more than one team or org,
  add `org_id` and scope the actions instead.

## D31. Demo mode runs the real pipeline in the browser

- **Choice:** a "Demo data" toggle on the Inbound board (Fred's request,
  2026-09-30). When on, 14 made-up leads from `fixtures/demo-cases.json` run
  through the real pipeline in an in-memory repository in the browser, as a
  snapshot at the most recent weekday 11:30 AM Pacific. Demo records and
  receipts use stable `demo-` ids. The toggle is remembered per browser, the
  demo engine loads only when used, and the agent is told through the
  `pa-demo-mode` app state and `view-screen`.
- **Why:** the preview could not load real data at the time (fixed in D32),
  and a demo built by the real rules cannot drift from what the pipeline would
  decide. Nothing is written to the database and nothing is sent. A fixed
  business-hours snapshot keeps the Running, At risk, and Breached states
  visible at any hour.

## D32. Local workspace access and the Settings render loop

- **Status:** The Settings fix and the pinned 0.197.0 patch were not ported (D40). On 0.176.4, local signed-in calls through the gateway hit the same app-access gate every xDR Hub app hits locally; it is not patched.

- **Settings loop (Fred's report, 2026-09-30):** core 0.197.0 runs Vite with
  dependency discovery off, and `@agent-native/core/client/settings` was not
  pre-bundled. Settings loaded a second `react-i18next` with no i18n
  instance, so `useT()` returned a new function every render and
  Settings > Integrations re-set its header forever ("Maximum update depth
  exceeded"). The loop starved navigation, so "Back to App" changed the URL
  without leaving Settings. Fixed by pre-bundling the seven core client
  entries PA imports in `apps/pa/vite.config.ts`, extending D29's fix.
- **Local workspace access:** 0.197.0 checks every signed-in `/api` and
  `/_agent-native` request against Dispatch's app registry with a signed
  A2A token. Local dev had no `A2A_SECRET`, so every call returned 503,
  including the Builder.io connection status, app state, and board data. A
  secret alone would not fix it: each local app has its own PGlite
  database, so Dispatch cannot recognize PA's org.
- **Choice:** a pinned pnpm patch,
  `patches/@agent-native__core@0.197.0.patch`, following xDR Hub's
  precedent of patching the auth guard. When `NODE_ENV` is `development`
  and the directory is a loopback gateway, the registry check steps aside
  and the framework's local org rules decide (the same rules it uses with
  no directory: org membership required, disabled apps denied).
- **Why:** production builds and remote directories keep the fail-closed
  check. The patch is pinned to 0.197.0, so a core upgrade forces a
  review; drop it once upstream handles local workspaces.

## D33. PA lives in xDR Hub at `apps/pa`, on the workspace's pinned core

- **Status:** Decided by Fred, 2026-09-29. Supersedes D1.
- **Choice:** the PA app is a workspace app in xDR Hub (`apps/pa`, mounted
  at `/pa`), on the workspace's pinned `@agent-native/core` 0.176.4 and
  `@agent-native/toolkit` 0.19.2. It deploys with the root workspace deploy
  to the existing `xdr-hub` Netlify site. There is no separate `pa-hub`
  workspace.
- **Why:** one front door, shared auth through Dispatch, and direct reuse of
  the workspace's HubSpot client, roles, and vault.
- **Consequences:**
  - Every framework fact in SPEC section 2 was written against 0.197.0 and
    must be re-verified against 0.176.4. Results so far are in D34 and D38.
  - Do not upgrade core for PA alone. A core bump moves every xDR Hub app and
    goes through `pnpm upgrade:agent-native`, `agent-native upgrade check`
    (the workspace carries a version-pinned core patch), and doctor.
  - The kit's docs live in `apps/pa/docs/`, because the workspace root
    `docs/` already holds Builder.LI's documents.
  - The scaffold's standalone `netlify.toml` and `scripts/migrate-production.ts`
    were removed. The workspace deploy ignores per-app deploy config, and they
    carried template analytics ids, template trusted origins, and keep-warm on
    (SPEC 8.5 says off).
  - `packages/shared` is where a PA module goes once a second app needs it
    (D2 still holds).

## D34. The durable sweep driver on 0.176.4 (open, needed before M1)

- **Status:** Open. Verified facts are below; the choice is made in M0.
- **Verified, 2026-09-29:** `registerRecurringSweepHandler` is not exported
  anywhere in 0.176.4. The workspace deploy does emit, per app, a
  `<app>-agent-recurring-jobs` Netlify scheduled function (every minute) that
  calls `/_agent-native/jobs/_process-sweep`, gated by the recurring-jobs
  build marker and requiring `A2A_SECRET`. That sweep runs `jobs/*.md`
  recurring jobs, which are agent runs.
- **Ruled out:**
  - A request-piggyback sweep like li-agent's `lead-pipeline-sweep`
    middleware. It stalls when nobody uses the app (CONTEXT, "Lessons from xDR
    Hub").
  - A recurring job whose body is an agent run for clocks and retries. That
    puts a model call on a fixed path (building guideline 3).
- **Candidates to verify in M0:**
  1. A Netlify scheduled function added at the workspace root that calls an
     HMAC-signed `/pa/api/internal/sweep` route (the kit's original fallback).
     Confirm the workspace deploy keeps a root-declared scheduled function.
  2. A framework hook inside the recurring-jobs sweep that runs app code
     without an agent run, if 0.176.4 source has one.
- **Also:** `A2A_SECRET` is not in the root `.env` locally. Confirm it is set
  on the Netlify site before relying on any scheduled trigger.

## D35. Reuse workspace infrastructure instead of rebuilding it

- **Status:** Decided, 2026-09-29.
- **Choice:** these parts of the kit's design use existing xDR Hub
  infrastructure:
  - **HubSpot transport and credentials:** `hubspotFetchWithTimeout` from
    `@xdr-hub/shared/server`, with the workspace vault key
    `HUBSPOT_ACCESS_TOKEN`. The gateway (SPEC 9) wraps it and adds what no
    workspace code has yet: a limiter, retries, 429 handling, a breaker, and
    the ledger. The CRM port's HubSpot adapter sits on the gateway. No
    PA-local token or credential form.
  - **Background identity:** `getHubSpotToken()` only reads the vault inside
    a request context, and webhooks and sweeps have none. Pipeline work runs
    inside `runWithRequestContext` with the workspace owner's context. The
    owner-context helper exists twice already (booking and li-agent), so PA
    lifts it into `packages/shared` instead of adding a third copy.
  - **Owner lookup:** `resolveHubSpotOwnerIdByEmail` from shared.
  - **People on our side:** permissions come from the shared
    `workspace_user_roles`. PA admin rights are `getWorkspaceRole(email) ===
"admin"` (fails closed), never a PA-local flag. `pa_user_profiles` keeps
    what is PA-specific: Slack user id, timezone, working hours, round-robin
    membership, design partner, the HubSpot owner id, and PA domain roles
    (`pa`, `ae`, `csm`) used for routing. Those domain roles grant nothing.
  - **Rep voice:** the lowest precedence tier (the rep's personal voice) is
    read with `getOutreachVoiceGuidelines` from shared.
  - **Inbound route shape:** follow booking's `nooks-webhook.post.ts` (raw
    body, `timingSafeEqual`, age window, dedupe on a unique index, 2xx on
    internal errors, `publicPaths` in the auth plugin), in addition to the
    framework's `integration-webhooks` pattern (D4).
  - **Evidence labels:** the workspace already uses locally running, locally
    verified, build-ready, deployed, and live-verified. PA reports with the
    same five.
- **Kept, because nothing in the workspace does it:** the event log,
  receipts, the playbook and releases, the outbox, pre-check and routing
  rules, clocks, draft lint, the Slack card, and the HubSpot webhook
  signature check.
- **Not reused:** lead-triage. See D37.

## D36. Booking moves into PA later; PA is the flagship

- **Status:** Decided by Fred, 2026-09-29. Booking work is deferred.
- **Choice:** PA is the flagship app. The booking app (meetings, intro
  calls, notes, deals, and its Contact Sales path) will later move into PA as
  PA modules on PA's object model. That move is not scheduled and is not part
  of M0 to M3. Until then, nobody changes `apps/booking` for PA's sake, and PA
  takes no runtime dependency on booking code or tables.
- **One gate stays:** before PA sends anything (M2), confirm that booking's
  Contact Sales polling and outreach are not sending, so no lead gets two
  first touches (G3). If they are, raise it with Fred then.
- **Fact:** the booking app already has an inbound path for the same
  submissions: `inbound_leads`, the `poll-hubspot-contact-sales` action (3-day
  search on `most_recent_contact_sales_date`), `fetchIntroCallResearch` (a
  CRM snapshot), `scoreIntroCallLead` (a deterministic scorecard), and Gmail
  sending. Its scheduled job calls `generate-lead-outreach`, which does not
  exist in any app.
- **When the move happens:** booking's meetings map to the "Meeting prep and
  follow-up" branch, and its deals and AE lookups map to "AE handoff"
  (OUTLINE, after M3). Its `inbound_leads` rows fold into PA engagements.
  Plan it as its own milestone with a data migration and a cutover.
- **Reuse now, as reference only (read, never import):**
  - `most_recent_contact_sales_date`, not `contact_sales_date`, marks a
    repeat submission. The backstop poll keys on it.
  - `fetchIntroCallResearch` is the reference for the adapter's property list
    and associations.

## D37. lead-triage is a separate product; PA follows its own docs

- **Status:** Decided by Fred, 2026-09-29.
- **Choice:** PA's core is its kickoff docs. `apps/lead-triage` triages
  existing HubSpot contacts on product usage (outbound and recycle). It has no
  form intake, and its vocabulary conflicts with PA's:
  - verdicts: `SAL | RECYCLE | NEEDS_ENRICHMENT | RE_ROUTE | DISQUALIFY`
    against PA's `QL | recycle | disqualify | attach_existing | route_elsewhere`
  - pre-check exits named by CRM state against PA's action outcomes
  - a 1 hour / 24 hour wall-clock SLA against 60 working minutes
  - "guardrails" meaning an outreach-outcome breaker
    PA does not import lead-triage's instructions, enums, thresholds, or code.
- **Allowed later:** if a PA module needs a generic helper that lead-triage
  also has (sentinel normalization, deliverability gates), lift it into
  `packages/shared` with tests and a PA-owned contract. Never import across
  apps.
- **Tables:** lead-triage's tables are unprefixed, and its `outreach_drafts`
  collides with li-agent's table of the same name in the shared database.
  The `pa_` prefix (D8) keeps PA clear of both.

## D38. Framework assumptions re-verified on 0.176.4

- **Checked 2026-09-29 against the installed package source:**
  - `runAgentLoop` is exported from `@agent-native/core/server`. The
    `agent-surfaces`, `processors`, `automations`, and `integration-webhooks`
    docs are present. D3's choice between the server-side loop and event
    automations is still made in M0, after reading them.
  - The Slack interactions route handles only `agent_native_approve`,
    `agent_native_deny`, and `agent_native_cancel`. D6 holds.
  - The Slack env vars in the root `.env` belong to Dispatch's framework
    Slack bot. The PA Inbound app uses `PA_SLACK_BOT_TOKEN` and
    `PA_SLACK_SIGNING_SECRET`.
  - `defineFeatureFlag` (D12) and `defineEval` exist.
- `runMigrations([...], { table: "pa_migrations" })` works on 0.176.4 (D28;
  the same shape li-agent uses), verified by the repository integration tests
  on SQLite and Postgres.
- `frameworkTools: { database: "off" }` and `initialToolNames` are accepted
  by the 0.176.4 agent chat plugin (D30 relies on the first).
- **Still to verify in M0:** the eval CI gate on this version.

## D39. "Respond automatically" in the MVP

- **Status:** Decided by Fred, 2026-09-30: hold off on sending anything
  automatically. First get to where a PA can clearly see the drafted message
  and how the lead was classified (D49). Option 1 below, for now; options 2
  and 3 stay open for after shadow data.
- **Request:** Fred wants the MVP to take in Contact Sales leads, triage
  them, and respond to them automatically.
- **Conflict:** D7 (never auto-send), D15 (the step 1d fast lane is
  deferred), and PRD section 7 (every send is approved by its owner).
- **New fact (D43):** the live process already auto-sends. Dobby sends the
  SAL first message or the Recycle qualify-out as soon as it decides, with no
  approval. So the question is not whether to start auto-sending but whether
  PA replacing Dobby keeps that behavior, narrows it, or adds approval.
- **Options:**
  1. Keep the docs: automatic intake, triage, routing, and drafting, and the
     owner approves each send. Auto-send stays an earned grant (D15).
  2. A narrow fast lane in M2 for one segment (for example, new, unowned,
     passing lint, no open deal), behind a flag, starting in shadow, with the
     outbox, a kill switch, and a measured bar.
  3. Auto-send for all QL leads from M2.
- **Until decided:** build to option 1, which is on the path to options 2 and 3.

## D40. The first build pass is ported into xDR Hub

- **Status:** Done, 2026-09-29. Fred: use the existing PA code and improve it
  where needed, following these docs.
- **What was ported:** the first build pass (D16 to D32, built on 0.197.0 in
  the Builder container): `server/core`, the `pa_` schema and migration,
  the repository, the actions, the PA board, record, labels, and ops routes,
  demo mode, the playbook compile script, evals, fixtures, and tests.
- **What was not ported, and why:** the 0.197.0 shell (AgentKit layout,
  `optimizeDeps` workarounds, the pinned 0.197.0 core patch, D29 and D32).
  PA keeps the xDR Hub 0.176.4 scaffold shell, with PA's destinations added to
  its sidebar. Toolkit 0.19.2 has no checkbox or switch, so both are local
  shadcn primitives on Radix and Tabler.
- **Changed while porting:**
  - **Portable schema.** The tables used `drizzle-orm/pg-core` and the
    migration used Postgres-only SQL (`JSONB`, `::jsonb`), which the workspace
    rules forbid and which does not run on local SQLite. Tables now use
    `@agent-native/core/db/schema`; JSON columns are TEXT, encoded and decoded
    only in `server/db/json.ts`; a corrupt JSON value throws with its column
    name. Migration version 1 was rewritten in place, which is safe because
    it has never run against the xDR Hub database.
  - **Tests on both dialects.** `test/integration/repository.*.test.ts` run
    the real migration and repository on SQLite and on Postgres (PGlite):
    replay outcomes, idempotency on the real unique indexes, and JSON round
    trips.
  - **Admin rights** come from the shared workspace role (D35).
  - **Receipts:** 0.176.4 has no per-call tool id, so the assessment receipt
    records the tool name and run id.

## D41. Fixes from the first code review of the ported core

- **Status:** Done, 2026-09-29. Each fix has a test; 90 tests pass.
- **Guardrail G3 (never a cold touch on an owned lead):**
  - A company owner makes a lead owned (SPEC 6), so an owned account
    attaches to the account owner (`crm_company_owner`).
  - Owners follow `rule.routing.order` whichever pre-check signal matched,
    so an active owner comes before a deal owner.
  - An attach with no owner anywhere needs manual assignment
    (`no_owner_found`) and is never round-robined.
  - Unknowns fail closed: an SAL with an owner and unknown activity, or an
    unmapped lifecycle value with an owner, is owned (provisional) and
    raises an open item. A confirmed deal or customer owner still comes
    first, which keeps the `open-deal-with-ae` label.
  - A stale SAL is reopened deliberately and the reason says so
    (`stale_sal_reopened`).
- **Pipeline (SPEC 5.2, 5.3):** only permanent errors (`PermanentStepError`,
  illegal transitions) fail at once; everything else retries with backoff up
  to 3 attempts. Claims hold a 10 minute lease, retries wait for their
  backoff, and a crash loop at the cap is marked failed.
- **One open engagement per contact (FR-2):** migration v2 adds
  `open_contact_id` with a unique index (portable: many NULLs allowed), kept
  by the repository only. The newest open engagement is the one a later
  submission attaches to. Contact, account, and scorecard races retry and
  re-read.
- **Round robin:** a profile whose working hours cannot be evaluated is
  skipped with `profile_hours_invalid`, instead of failing every lead.
- **Assessment (FR-4, SPEC 12):** quotes need 3 non-space characters; an
  agency signal or a named end client needs a quote. `save-message-assessment`
  is limited to workspace admins until the M1 agent step has its own identity
  (D3), saves once per submission, and writes the `assess_message` receipt
  the pipeline reuses.
- **Untrusted text (SPEC 14, D26):** the delimiter escape repeats until
  stable; form name and company are quoted for agent callers and scanned for
  injection patterns.
- **Identity:** regional personal mailboxes (yahoo.co.uk, hotmail.fr,
  gmx.net, and others) are flagged; punycode TLDs are accepted.
- **Deferred, with a reason:**
  - The board runs about 8 queries per engagement, capped at 500 rows, and
    round-robin counts read the same capped list. Batch these before M1 live
    traffic (SPEC 17).
  - The synthetic dev pool is supplied only by demo and replay. The live
    pipeline must pass an empty `devPool` (documented on `PipelineDeps`).
  - Replaying a case that already ran returns its stored result, and attached
    submissions are evaluated against the current release, not the
    engagement's pinned one (SPEC 11). Fix with the replay work in M0.
  - The CRM snapshot skips the company when no CRM contact exists. Fred asked
    for no CRM changes in this pass, so the port is unchanged; the case
    raises `crm_contact_missing` instead.

## D42. Does message intent outrank ownership? (open, needs RevOps and Fred)

- **Status:** Open, 2026-09-29.
- **Fact:** D21 evaluates `rule.precheck.outcomes` in declared order, so
  support, educational, selling_to_us, and junk come before the ownership
  signals. The seed case `support-request` (a customer asking for help)
  relies on this and routes to support.
- **Problem:** an owned SAL contact whose message the agent reads as `junk`
  or `selling_to_us` is ignored, and its owner never sees the new ask. That
  conflicts with FR-3's acceptance and D20's rationale.
- **Options:**
  1. Keep the declared order (today's behavior).
  2. Ownership first for junk and selling_to_us only; support and
     educational keep their order. Proposed, because a model judgment should
     not silently hide a lead from its owner.
  3. Ownership first for every intent, which changes `support-request`.
- **Needs:** a playbook release, since this is a rule change (CONTEXT: every
  playbook change is a release).

## D43. Reconcile playbook v1 with the xDR Playbook (open, needs Fred and RevOps)

- **Status:** Open, 2026-09-29. Source: the xDR Playbook in Notion (see
  `SOURCES.md` and the CONTEXT section "How inbound runs today"). Nothing in
  `playbook/` or the code has changed yet; each item becomes a playbook
  release once its owner confirms.
- **Conflicts with the kit, and proposed changes:**
  1. **Verdicts.** Dobby's live decision is SAL or Recycle for non AE-owned
     leads. The kit's `def.sal` says SAL is set by the owning rep after the
     step 2b QL to SAL decision. Proposed: map PA's `ql` verdict to what the
     team calls SAL, and confirm with RevOps which lifecycle value PA
     proposes.
  2. **Clocks.** There is no Contact Sales SLA today because the first touch
     is sent at once; the 24 hour SLA applies to QLs. `rule.sla.first_touch`
     (60 working minutes, TODO) should follow D39: with an automated first
     touch the clock measures the send, and the xDR's clock is on the call
     steps and the intro call.
  3. **Routing needs segment and the xDR owner.** Routing depends on
     employee count (4,000 splits Enterprise and Commercial), the company
     owner's role (AE or xDR), and a separate xDR owner field. PA's CRM
     snapshot has neither headcount nor the xDR owner, and
     `hubspot-mapping.yaml` has no entries for them. The workspace's shared
     `fetchCompaniesByOwner` already reads the `xdr_owner` property. This
     needs a mapping and adapter change, which is on hold: Fred asked for no
     CRM changes in the current pass.
  4. **Who gets a lead with no owner.** The kit round-robins among PAs; in
     practice non AE-owned Contact Sales goes to the two inbound xDRs, and
     unowned leads round-robin to an Enterprise or Commercial xDR by
     segment. `config/routing-pool.yaml` needs those people's emails from the
     PA lead, per segment.
  5. **Agencies.** The kit routes agencies to a partner rep before round
     robin. The team's rule has three paths keyed on the end user, and only
     "no end user" goes to Partnerships; a named client goes to the client's
     territory AE with Partnerships looped in. `agency_partner_rep` is the
     wrong shape: it should become the three-path rule, and
     `msg.agency.first_touch` should carry the team's question about the
     client's size and HQ.
  6. **Restricted countries.** The list exists: Cuba, Iran, North Korea,
     Syria, Russia, Belarus, Crimea, Donetsk, Luhansk. Crimea, Donetsk, and
     Luhansk are regions, not ISO countries, so a country field alone cannot
     catch them; that needs a region or city check, recorded as an open item.
  7. **Product bars.** `rule.enterprise.bar` (20 Code seats) matches the
     team's bar. Missing: Builder Content has no self-serve plan, so Content
     leads are buying intent and junior titles never disqualify; the 1M+
     page-view bar for CMS trial requests; enterprise-only feature asks (SSO,
     RBAC, self-hosted git) as a signal. These belong in the scorecard's
     rules and in knowledge entries.
  8. **Sending means sequences.** Today the first touch is a HubSpot sequence
     enrollment with the xDR's calendar link, and "check the contact is not
     already in an active sequence" is a hard rule. The kit's M2 plan sends
     one Gmail message. Enrolling is a CRM write, so it waits for M2 and
     Fred's call on CRM writes; the "already enrolled" check is a read and
     belongs in the pre-check.
  9. **Message rules.** Add: say "Account Director," never "Expert"; never
     propose a meeting on a Tuesday (PG Tuesday).
  10. **The monitoring job is catching wrong recycles.** The board's first
      view for inbound xDRs should be "recycled today," with a one-tap pull
      back that records a correction (FR-11). This fits the M1 board.
- **What already matches:** AE-owned Contact Sales goes to the AE and gets
  no PA draft; outbound-owned accounts go to their owner; the 20 seat Code
  bar; the Dobby teardown's agency lessons.

## D44. The playbook is app data, co-owned by the PA team and RevOps

- **Status:** Decided by Fred, 2026-09-30. Supersedes D9 and narrows D24.
- **Choice:** the playbook lives in the database. The seed YAML is imported
  once as the first release; after that, people edit through change sets
  (draft, check, review, publish) at `/playbook`.
  - Releases stay immutable and content-hashed. The `active` label in
    `pa_release_labels` is the one mutable pointer, moved by compare-and-set.
    Engagements keep the release they were decided under.
  - Every entry has an `owner_team` (`pa_team`, `revops`, or `both`). A
    change publishes when each owning team approves, from a member who is
    not the author. Moving an entry between teams needs both. The app owner
    (the workspace admin) stands in only for a team with no members, and the
    approval records it. Roles are framework app roles (`defineAppRoles`),
    assigned on the Team page.
  - Approvals are tied to a fingerprint of the base release and the items,
    so any edit voids them. A change whose base is no longer active is
    rebased on its next check, and a conflict with the published change
    needs a person.
  - Approving, rejecting, and publishing are people's decisions: those
    actions are hidden from every agent tool surface (`agentTool: false`),
    and the workflow also refuses `tool` and `automation` callers.
- **Checks turn changes into requests for the other side.** Before approval,
  code checks each change against `capabilities.ts`, the app's account of
  what it enforces:
  - params that fail their schema block publishing
  - a rule with no evaluator publishes as `pending_build`, shown as "Not
    enforced yet", never evaluated, and raises a feature suggestion to the
    app owner with a draft spec
  - a param, pre-check signal, or routing step code does not read raises a
    feature suggestion
  - a CRM field a rule reads that is unmapped, or a field it declares in
    `needs_fields` that the CRM port does not expose, raises a request to
    RevOps (and a feature suggestion to read it). No CRM write, ever.
  - a knowledge entry marked missing raises a request to the PA team
  - a replay of the synthetic cases shows which would pre-check, route, or
    score differently
- **The app adapts.** Suggestions land in `/suggestions` and the notification
  bell, and by Slack DM once the PA Inbound bot token exists (D45). On every
  publish, the agent review (`pa-playbook-review`) is queued durably with
  `queueAutomationRunNow`, not the in-process event bus, which is not durable
  on serverless. A weekly job (`pa-weekly-learning`) compares the rules with
  how the team worked. Both run as the app owner, follow the
  `playbook-steward` skill, and can only draft changes and record
  suggestions; the app owner turns them on with `enable-playbook-review`.
  Board reorganizations are proposed as `view.*` entries, which the app does
  not render yet, so each one also raises a feature suggestion.
- **Why:** rules change weekly, owned by two teams; a published rule that code
  silently ignores would be worse than the YAML it replaces; and what one
  side decides usually needs work from the other side.
- **Verified:** 114 tests on SQLite and Postgres (PGlite), including the full
  flow on both; the migrations applied on a local dev boot; the seed import
  recorded its six audit suggestions; a change was drafted and checked
  through the CLI.
- **Open:** the weekly job needs the scheduled driver on Netlify (D34:
  `AGENT_NATIVE_BUILD_RECURRING_JOBS=enabled` and `A2A_SECRET`). Rendering
  `view.*` entries on the board is a later feature. The labeled set replaces
  the synthetic cases in the impact preview once labels exist.

## D45. Slack DMs to staff before M1

- **Status:** Decided by Fred, 2026-09-30.
- **Choice:** playbook suggestions may DM the PA team, RevOps, and the app
  owner before M1, through the separate PA Inbound Slack app (D6). Nothing
  reaches a lead; M0's "no Slack posts" still holds for anything
  lead-facing.
- **How:** a `pa-slack-dm` notification channel that only handles PA
  suggestion notifications, escapes text, disables unfurls, times out at 5
  seconds, and returns "skipped" until `PA_SLACK_BOT_TOKEN` is set (vault
  first, env fallback). It needs the Slack app's `chat:write`, `im:write`,
  and `users:read.email` scopes.

## D46. The playbook is a block builder

- **Status:** Decided by Fred, 2026-09-30. Builds on D44.
- **Choice:** building the playbook works like a CMS. Block types live in
  code (`shared/playbook-blocks.ts`): each has a zod data schema, a label and
  icon, the sections it may go in, its owning team, an empty value, and a
  build brief. Block instances are playbook entries: an entry now carries
  `block`, `section`, and `position`, and its `params` are the block's data.
  The routing pool and the HubSpot mapping are config blocks.
  - `/playbook` shows a palette of block types and nine sections. Drag a type
    into a section (or use the plus) to add a block; drag cards to reorder;
    open a card to edit it with a structured editor (the country picker adds
    and removes elements; routing steps and pre-check signals are sortable;
    numbers, clocks, and message rules are fields). Types without a custom
    editor use core's `SchemaBlockEditor`.
  - Every edit stages into the viewer's open draft change, so edits are
    durable and visible to the agent, and go through D44's checks and
    approvals unchanged. The change page shows readable diffs.
  - Editing starts from the full entry, so fields an editor does not show
    survive. The previous edit sheet dropped `scope`, `sources`, `status`,
    `precedence`, and extra keys; it is removed.
  - A block that code cannot evaluate publishes as not enforced, and the
    feature request to the app owner carries the block type's build brief:
    this is how the playbook tells the app what to build and how.
  - Checks validate each block's data against its type, and a supported-values
    list per param (the CRM system block asks for a Salesforce adapter when it
    picks Salesforce).
  - While the active release is still an untouched seed import, a newer seed
    replaces it; published releases never move this way.
- **Deviation from the plan:** the plan said to wrap each type with core's
  `defineBlock` (`@agent-native/core/blocks`). In 0.176.4 that contract is
  built for MDX documents (every spec needs an MDX round trip and React
  renderers), and playbook blocks are server-validated entries, so wrapping
  would need fake MDX stubs. PA uses core's `SchemaBlockEditor` as the
  fallback editor, and gives the agent its vocabulary through
  `list-playbook-blocks`, generated from the same registry with zod's JSON
  Schema export.
- **Adds:** `@dnd-kit/core` 6.3.1, `@dnd-kit/sortable` 10.0.0,
  `@dnd-kit/utilities` 3.2.2, the versions the framework's own templates use.

## D47. CRM connections: an owner-only page and the org secret slot

- **Status:** Decided by Fred, 2026-09-30.
- **Choice:** `/crm` is the app owner's page for CRM credentials, so PA is
  not tied to one CRM.
  - HubSpot: a private app token, tested with a read-only call before it is
    saved, then stored by the framework's encrypted secret store (AES-256-GCM)
    at org scope, as `HUBSPOT_ACCESS_TOKEN`. That is the slot the shared
    HubSpot client and the Dispatch vault's sync write and read, so every
    xDR Hub app uses the same key. OAuth goes through the framework's
    workspace connection route.
  - Salesforce: OAuth only, through the same route; PA shows its status, and
    choosing Salesforce in the CRM system block requests its adapter.
  - The page and its actions are for the app owner in person: hidden from the
    agent (`agentTool: false`), refused for tool and automation callers, and
    audited without inputs. No action returns a credential; the page shows
    set or unset, the last four characters, and when it changed.
- **Why not the Dispatch vault alone:** the vault stores its own copy of each
  value in its `vault_secrets` table, and no encryption for that copy was
  found in `@agent-native/dispatch` 0.33.1 (the org-scope copy it syncs is
  encrypted). PA writes the encrypted slot directly.
- **Gating:** owner means the workspace admin (`isPaAdmin`), the xDR Hub
  standard for admin actions. The framework's own secret routes also require
  an org owner or admin role; PA's actions do not go through them.

## D48. HubSpot mapping: read-only schema, typed fields, RevOps approval

- **Status:** Decided by Fred, 2026-09-30. Read-only HubSpot calls are
  allowed; no CRM writes, ever.
- **Choice:** the CRM field mapping block has its own editor.
  - `refresh-crm-schema` (app owner or RevOps) reads contact, company, and
    deal property definitions and stores names, types, groups, options, and
    read-only flags in `pa_crm_schema` (migration v5). No record data.
  - Each canonical field PA reads has an object and an expected shape
    (`shared/crm-mapping.ts`). The editor shows what it means, which rules
    read it, and a searchable picker filtered to compatible types; the SAL
    value is picked from the lifecycle property's own options.
  - "Suggest mappings" is a deterministic scorer (name and label match plus
    type fit). It proposes; a person reviews and stages.
  - With a snapshot, checks block a mapping change that points at a property
    the portal lacks or whose type does not fit; an older problem becomes a
    RevOps request instead of blocking unrelated changes.
  - Mapping edits are a RevOps-owned block, so RevOps approves every one.
  - After a publish, check-raised suggestions the new release resolves close
    themselves (for example the "map the SAL value" request).

## D49. Triage first: the classification and the draft come before the evidence

- **Status:** Decided by Fred, 2026-09-30. "The PA needs to see one thing at
  first: how the lead was qualified and what message was drafted."
- **Choice:**
  - The draft step runs (SPEC 5.3 step 7). A new, routed lead with an owner
    gets a first-touch draft, linted against the pinned message rules
    (SPEC 5.5) and saved to `pa_drafts` as `proposed` or `needs_edit`.
    Every other outcome records why there is no draft. Nothing is sent (D7,
    D39). Replay and demo use recorded drafts (`fixtures/drafts.recorded.json`,
    `demo-cases.json`); the live path is the agent through `save-draft` until
    the D3 agent step lands.
  - Every board row and record carries `triage` (kind, label, why, next
    step) and a draft summary, built by one pure function
    (`server/core/views/triage.ts`) that the board, the record, the browser
    demo, and the tests share.
  - Board columns: lead, classified as, drafted reply, owner and clock.
    State, route, and last event moved to the record.
  - The record opens on two cards: how it was classified (label, why, next
    step, their question) and the drafted reply as an email (to, from,
    subject, body, lint result, copy, ask the agent to revise). The full
    message, pre-check, route, scorecard, clocks, timeline, and receipts sit
    under "Details", collapsed. `j` and `k` step through the board's queue.
  - The owner's calendar link is a `[calendar link]` placeholder, filled at
    send time (M2), so a draft never carries a link the agent made up.
  - `save-draft` is open to any signed-in PA user's agent, not only admins:
    it only proposes, lints every save, keeps every version, and is audited.
- **Not checked by code yet:** "names a customer without an approved
  reference entry" (no reference list exists). The record says so.
- **Also fixed:** the port had dropped PA's status color tokens from
  `app/global.css` (amber, red, pine, the clock rail), so at-risk and
  breached states rendered without color. Restored from the first pass.

## D50. Inbound first; the playbook builder is parked

- **Status:** Decided by Fred, 2026-09-30.
- **Choice:** the next work is inbound handling: how Contact Sales leads are
  triaged and actioned. The dynamic playbook, block builder, and CRM mapping
  (D44 to D48) stay as built but get no further work for now. The pipeline
  keeps reading its rules from the seed release, so nothing depends on the
  builder.
- **Order:** read-only HubSpot adapter, intake (webhook plus backstop poll),
  the sweep driver (D34), the agent steps, then shadow (M1).

## D51. The SLA timer and the sales cycle replace the first-touch clock

- **Status:** Decided by Fred, 2026-09-30. "If the lead is being triaged and
  actioned automatically, then what is the point of the clock?"
- **Choice:** the clock is renamed the **SLA timer**. It does not time
  triage; it marks two human milestones against the playbook's two SLAs:
  1. First contact, within `rule.sla.first_touch` (working minutes in the
     owner's hours).
  2. Marked SAL, within `rule.sla.decision` (hours from submission).

  The timer is on the first open milestone; the board's At risk and Breached
  tabs and its sort order follow it. Leads with no one to contact say
  "No SLA".

- **Sales cycle:** every record shows MQL, QL, SAL, S0, NBM booked, NBM
  complete, S1 (Fred's order). PA records MQL (the form), QL (the scorecard),
  SAL (the owner's state change, or HubSpot's lifecycle for a contact that is
  already SAL), and NBM booked. S0, NBM complete, and S1 come from HubSpot
  deals once the adapter reads them; until then they show as upcoming.
- **Open:** the engagement state machine lets `meeting_booked` come before
  `ql` and `sal`, while Fred's cycle puts SAL before NBM booked. Align the
  transitions when marking SAL and booking land (M2).

## D52. Dispatch opens workspace apps on a catch-all route

- **Status:** Fixed, 2026-09-30.
- **Bug:** "Open app" on Dispatch's Apps page did nothing for PA. Dispatch's
  route file was `apps.$appId.tsx`, which matches only `/apps/pa`; the
  framework template's is `apps.$appId.$.tsx`. PA redirects to `/inbound`,
  Dispatch mirrors that as `/apps/pa/inbound`, and no route matched.
- **Fix:** renamed the route to `apps.$appId.$.tsx`, the template's name.
  Opening in a new tab was unaffected because it skips the host.

## D53. The Sales handbook lives in PA

- **Status:** Decided by Fred, 2026-09-30. "It should be in the Product
  Advocate Hub, it should not live in dispatch, only this app."
- **Choice:** PA's reference docs on the sales cycle and how the team works
  (qualification, lead routing, personas, the email playbook, sales stages)
  live in PA's own tables, `pa_handbook_docs` and `pa_handbook_revisions`
  (migration v7), at `/handbook`.
  - Everyone signed in reads it; the app owner and PA role holders (PA team,
    RevOps) edit it in the page with a rich Markdown editor. Every save keeps
    the prior version; History shows and restores any version; a stale edit
    is refused.
  - Import takes `.md` files (the page, or `import-handbook-docs` from the
    CLI). A README with a file index supplies each doc's summary; a doc
    marked LEGACY is filed under Legacy.
  - The agent reads it (`list-handbook` with search, `get-handbook-doc`) and
    cannot edit it: editing and import are people-only, so text in a lead's
    message can never rewrite the handbook.
- **Why not source files:** the content is internal (AE and partner names,
  HubSpot IDs, price anchors, customer names). Workspace rules keep that out
  of the repo, docs, and fixtures. Tests use synthetic docs only.
- **Why not Dispatch Resources:** Fred wants it in PA only, and a shared
  resource in the workspace database is visible to other apps' agents.
- **The playbook still wins at runtime.** The handbook is reference. Where it
  differs from the pinned release, the release decides until the change is
  reconciled through the playbook (D43). Differences found on import:
  - Contact Sales first response: 30 minutes in the handbook,
    `rule.sla.first_touch` 60 working minutes (TODO) in the playbook.
  - Email length: under 75 words in the handbook, 50 to 140 in
    `msg.first_touch.structure`.
  - No colons in email subjects or bodies (handbook); no playbook rule yet.
  - Highly Qualified Contact Sales offers two specific times; PA's drafts use
    the calendar link as the call to action.
  - Contact Sales is classified Content or Code, Highly Qualified or
    Standard, before drafting; PA's scorecard does not do this yet.
  - Agency routing paths A, B, and C, with named AEs and the partner manager
    always on Path B meetings; PA routes agencies to one partner rep.

## D54. Real leads: HubSpot intake, the HubSpot adapter, and the inbound agent

- **Status:** Decided by Fred, 2026-09-30: "get real leads in here, and
  let's start drafting responses to those folks." Shadow mode: nothing is
  sent, nothing is written to HubSpot (D7, D39).
- **Intake (D5):** `pull-contact-sales` searches contacts by
  `most_recent_contact_sales_date` (read-only), keys each submission by
  contact id and `most_recently_contact_sales_date__date_time_`, and inserts
  it into `pa_inbox` once. The poll is the main path until the HubSpot plan
  is confirmed for a workflow webhook. Form answers (use case, tech stack,
  budget status, company size, Breeze fit score, title) ride on the
  submission as data.
- **CRM port:** `HubSpotCrmAdapter` reads the contact, company, open deals
  (`hs_is_closed` false), and owners through the shared
  `hubspotFetchWithTimeout`, with property names from
  `config.hubspot_mapping`. The portal's custom lifecycle values are read
  through the property definition and mapped: RAW to lead, MEL to mql, QL,
  SAL, S0 to sql, S1 to opportunity; Recycle, Excluded, Disqualified, and
  Closed keep their raw label only. Writes throw.
- **Agent steps (D3, resolved for the live path):** the pipeline waits for
  the agent instead of failing. With no saved assessment it halts and records
  `agent.work_requested`; `save-message-assessment` resumes the run (fresh
  attempts) through pre-check, route, score, and the draft step, which asks
  for a draft the same way. `list-agent-work` is the queue.
- **The inbound agent:** an organization automation (`pa-inbound-agent`),
  turned on by the app owner from the board, runs every 30 minutes as the
  owner: pull, then assess and draft everything in the queue with the
  inbound-message-assessment and first-touch-drafting skills. A manual pull
  also wakes it with `queueAutomationRunNow`. This is also the scheduled
  driver D34 asked for, for now; a model run every 30 minutes is the
  accepted cost until a deterministic sweep replaces the polling half.
- **Unowned leads still get a draft.** The routing pool is still empty, so a
  new lead is routed without an owner; its draft is signed
  `[owner first name]` until it is assigned. Filling `config.routing_pool`
  with the real PAs turns on round robin and the SLA timer for them.
- **Not yet:** Dobby's own message (`dobby_message_1`) is readable for a
  side-by-side comparison in shadow; not shown yet.

## D55. Drafts follow the Sales handbook

- **Status:** Decided by Fred, 2026-09-30: "make sure that the emails are
  actually following the handbook."
- **Choice:** `msg.first_touch.structure` now restates the handbook's email
  playbook (05) and Contact Sales handling (03), and the lint enforces what
  code can check:
  - no colons (times and links excepted), no em or en dashes
  - 25 to 130 words, with a warning above the handbook's 75
  - banned sign-offs and phrases ("Best regards", "Sincerely", seller
    questions), and never "Builder.io", "Fusion", or "Publish"
  - no price outside the Content price check
  - a meeting needs `[time options]` (two 30 minute options) or the
    calendar link
  - signed with the owner's first name, or `[owner first name]`
    Every draft records its Contact Sales class (`approach`: Highly Qualified
    or Standard, Content or Code, price check, agency), shown on the draft.
- **SLA:** `rule.sla.first_touch` is 30 minutes, from the handbook, replacing
  the unconfirmed 60.
- **Still judgment, not code:** the class itself, TCQ, which questions to
  ask, and customer evidence. The skill carries those; evals should cover
  them next.

## D56. Only Contact Sales form submissions come in, each with its HubSpot link

- **Status:** Decided by Fred, 2026-09-30: "I currently only wanna pull
  Contact Sales (defined as someone who submitted the form)."
- **Fact (read-only, 2026-09-30):** `most_recent_contact_sales_date` is also
  set for other forms, such as a livestream registration and a meetings
  link. So the date only narrows the search.
- **Choice:** a contact is Contact Sales when `form_type` is "Contact Sales"
  (the Sales Demo form) or "Thank You Page Questionnaire" (which only follows
  it), or the recent conversion is the Sales Demo form. Other matches are
  left out, and a row pulled before this rule is hidden (inbox `skipped`,
  with the reason).
- The questionnaire answers come in with the lead: business driver, how
  they will measure success, budget status, and who makes the final call.
- Every live lead links to its HubSpot record (portal id from
  `/account-info/v3/details`), on the board and the lead page; rows pulled
  earlier get the link on the next pull.
- A live lead the agent has not read yet says "Waiting for the agent".

## D57. Ownership is read as of the submission; HubSpot owners show by name

- **Status:** Fixed, 2026-09-30, from Fred's question on a lead that showed
  "Existing owner" but "Unassigned".
- **What "existing owner" means:** the contact or its company already had an
  owner in HubSpot before this submission, so the lead belongs to that
  person and gets no cold reply (G3).
- **Bug 1:** HubSpot's own Contact Sales handling assigns an owner (and logs
  activity) minutes after the form. PA read HubSpot after that, so a brand
  new lead could look owned. Now an owner whose `hubspot_owner_assigneddate`
  is within 30 minutes before the submission, or after it, is the intake
  assignment: it never makes the lead owned; routing follows it as the new
  lead's owner ("assigned in HubSpot for this submission"), and the draft is
  signed with their name. The 30 minutes cover HubSpot stamping the
  submission time a few minutes after the form.
- **Bug 2:** an owner with no PA profile showed as "Unassigned". The owner
  now shows by name with a "HubSpot" tag; the SLA timer says the owner has
  no PA profile yet.
- **Bug 3:** the sales cycle ignored HubSpot's own stages. A HubSpot
  lifecycle of QL, SAL, S0, or S1 now marks those stages done.
- **Leads already triaged** keep their first snapshot; a new submission
  from the same contact is read the new way.

## D58. The minute poll: new leads come in on their own

- **Status:** Decided by Fred, 2026-09-30: "the app should automatically
  pull in the new leads that come in immediately so it should monitor for
  new leads." Resolves D34 for intake and deadlines.
- **Choice:** a Netlify scheduled function at the workspace root
  (`netlify/functions/pa-intake-poll.mts`, every minute) makes a signed call
  (HMAC-SHA256 of the timestamp with `A2A_SECRET`, fresh within five
  minutes) to `/pa/api/internal/intake-poll`. PA then, as the workspace
  owner (`WORKSPACE_OWNER_EMAIL`): pulls the last 6 hours of Contact Sales
  submissions (read-only; the inbox key dedupes), wakes the inbound agent
  when a new lead arrived or work has waited 10 minutes, and checks decision
  deadlines. No model call on the fixed path.
- **Why not the framework's recurring-jobs sweep:** in 0.176.4 it only runs
  agent jobs; there is no hook for app code (verified in
  `dist/server/agent-chat-plugin.js`).
- **Latency:** about a minute after HubSpot stamps the submission. A HubSpot
  workflow webhook (D5) would be instant but is a CRM change.

## D59. The rep decision loop, and no "existing owner" class

- **Status:** Decided by Fred, 2026-09-30: remove "the confusing classifier
  of Existing owner, because there is always an owner"; run the rep decision
  loop automatically for new leads, with a button for older leads. The
  timeout records and alerts only; sending stays drafts only (D39).
- **Classification:** an owned account is classified by the lead itself
  (Qualified lead, routed to the account owner) and gets a draft for its
  owner. An open deal is "Open deal" (to the AE, not a PA play). An existing
  customer with no open deal is "Existing customer" with the workflow 1b
  question flagged: same team (redirect to AE and CSM) or another BU
  (expansion).
- **The loop (workflow 2b):** every lead routed to a rep (pre-check continue,
  owned accounts, existing customers without a deal) gets one decision in
  `pa_decisions` (migration v8) with PA's recommendation, a reason, and a
  due time 24 hours from the submission (`rule.sla.decision`). Choices:
  accept and sequence (to SAL in PA), decline and recycle, research more
  (stays open, note kept); with a meeting booked after the form
  (`engagements_last_meeting_booked`), take it, disqualify, bring in an AE,
  or route elsewhere; for customers, customer redirect (4d, its own exit,
  reportable). Every choice is recorded against the recommendation.
- **Timeout:** the minute poll marks the miss once and notifies the rep and
  the app owner. Nothing executes (Fred's answer, 2026-09-30).
- **Older leads:** "Decide on older leads" gives each lead without a
  decision one, due 24 hours from the click, so old leads are not all late.
- **PA only:** decisions change PA's state; HubSpot is not written.
- **Recommendation today** is deterministic from the scorecard and flags;
  the Scorecard Agent's written recommendation (workflow 1c, 2a) replaces
  the reason text when deep research lands.

## D60. The agent runs on its own, right after a lead arrives

- **Status:** Fixed, 2026-09-30. Fred: "the message is not drafting
  automatically, the entire decision making and evaluation should happen
  immediately after the lead comes in."
- **Cause (from the poll logs):** the minute poll found the leads and 11 of
  them waited for the agent, but it never woke it (`agent: skipped`). The
  owner lookup returned no organization, and the agent only existed after
  someone clicked "Turn on the inbound agent".
- **Fix:** the board remembers the workspace organization from any
  signed-in viewer, and the poll falls back to it (a failed lookup is no
  longer cached). The poll turns the inbound agent on itself when it is
  missing, wakes it the minute a new lead arrives, and again after three
  minutes if work is still waiting. One agent run assesses, triages,
  drafts, and opens the decision for every lead in the queue.

## D61. Triage and drafting follow the xDR master instructions

- **Status:** Decided by Fred, 2026-09-30: his lead's Claude project for
  qualifying inbound leads ("salvage what you can to draft and triage the
  lead as best as possible").
- **The Contact Sales class in code** (`server/core/qualify`): Content or
  Code first (the form's use case, the message, the assessment), agencies
  first, then the project's criteria. Highly Qualified Content is 2 of 3
  (Breeze 7+ or enterprise scale, a detailed message with a specific
  initiative, 2+ of the 5 Content questions answered); Highly Qualified Code
  is all 3 (Breeze 5+ or enterprise scale, manager-level title, a specific
  enterprise need), or 2 of 3 at enterprise scale. Each criterion shows as
  met, not met, or unknown, with its evidence, on the classification card,
  and the agent reads it. The price check needs known page views, which PA
  does not have, so it never triggers from code.
- **Data for it:** company employees, industry, and revenue from HubSpot;
  title, Breeze, company size, use case, and the questionnaire from the form.
- **The lead brief** (`pa_lead_briefs`, migration v9, `save-lead-brief`):
  the project's CRM note as data: persona, deal role, use case, the V2 read,
  the five Stage 1 gates each met, gap, or unknown with evidence and the
  next move, enterprise signals, agency routing, gaps and risks, next step.
  The agent writes it before the draft. "Copy CRM note" formats it the
  project's way for the rep to paste into HubSpot; PA writes nothing there.
- **The drafting skill** carries the project's formulas, question selection
  logic, the peer test, what not to ask, voice, the fabrication line, and
  flag-don't-block. Names of internal people, the portal id, and the price
  anchor stay in the Sales handbook (PA's database), not in source.
- **Not taken:** the project's live web and LinkedIn research, the 5-contact
  multithreading add-on, and the Notion content database; they need sources
  PA does not reach yet (workflow 2a).

## D62. Drafts are held to the TCQ rubric, on a writing model

- **Status:** Decided by Fred, 2026-09-30, on a draft that "does not follow
  any guidelines or rubric", with the team's TCQ email generator.
- **What went wrong:** the trigger paraphrased the form, the connection was
  a product pitch ("Builder's visual CMS can help teams"), a filler line
  ("I'll confirm the best-fit approach and get back to you") was there only
  because PA's own lint demanded the word "confirm", the question was an
  interrogation, Enterprise-only was missing. The agent also ran on the
  workspace's fast default model.
- **Rubric in code:** every draft saves its TCQ parts (`rubric.trigger`,
  `connection`, `ask`). The lint blocks a trigger that is not the lead's own
  words from the message or a form answer, or that the email does not use;
  a Content draft that does not say the CMS is part of the Enterprise plan;
  a Standard draft with fewer than two questions; a meeting without two days
  offered; pitch and filler phrases ("can help teams", "best-fit", "get back
  to you", "our platform", "unlock", "leverage"). No peer connection is a
  warning. The "must say confirm" rule is gone.
- **Days, not slots:** meetings offer two days (for example Wednesday or
  Thursday), no calendar link, per the team's project memory.
- **Model:** the inbound agent runs on `claude-sonnet-5` (SPEC 5.4 asked for
  Sonnet for drafting). The minute poll keeps the running automation's
  instructions and model current.
- **Existing drafts:** draft rules are versioned; an undecided lead whose
  draft predates version 2 goes back to the agent's queue and is redrafted.

## D63. Refresh from HubSpot, so old and new leads are equal

- **Status:** Decided by Fred, 2026-09-30: "add a refresh button so that
  old and new leads can be equal."
- **Choice:** "Refresh from HubSpot" on a lead, and "Refresh all leads" on
  the board. A refresh re-reads the contact (read-only) with today's
  properties (form and questionnaire answers, owner assignment dates, the
  record link), applies the Contact Sales filter, closes the old engagement
  as `refreshed` and hides it (kept for history), and runs a fresh inbox row
  through today's pipeline: ownership as of the submission, classification,
  the Contact Sales class, the decision (due 24 hours from the refresh), the
  lead brief, and a TCQ draft.
- **Bulk:** "Refresh all leads" queues every undecided live lead (inbox
  status `refresh`); the minute poll refreshes a batch each minute and wakes
  the agent. Decided leads are left alone; a single decided lead can still
  be refreshed after a confirmation.

## D64. Contact history from HubSpot, and first touches sent from HubSpot

- **Status:** Decided by Fred, 2026-09-30: a lead "was actioned in HubSpot,
  but then the draft disappeared. Instead of just disappearing, add the
  contact history, showing the email(s) that was sent and any previous
  contact points."
- **Contact history** (`get-contact-history`, read-only): the contact's
  emails (subject, direction, sender, text), calls, meetings, and notes
  through the v4 associations and batch reads, plus Dobby's Contact Sales
  message (`dobby_message_1`), newest first, on every live lead. Anything
  the token cannot read (for example a missing email scope) is named.
- **First touch from HubSpot:** the minute poll checks a few open leads a
  minute (each at most every 10 minutes). An email we sent after the form
  marks the first touch: the SLA timer's contact milestone is met, the lead
  moves to first touch sent, and PA stops drafting a first touch for it. The
  draft card shows that email ("Already contacted from HubSpot").
- **The agent reads the history** before drafting or revising, so it never
  repeats what was already sent.

## D65. Messaging lives in the playbook (2026-09-30)

- Fred: "It should live in the playbook." The xDR master instructions and
  the TCQ framework (D61, D62) had been written into the drafting skill, so
  nobody could see or edit them in the app.
- **The Messaging section holds them** as message rule blocks:
  `msg.first_touch.structure` (the TCQ rubric, with the lint params), `.voice`,
  `.questions`, one block per class (`.hq_content`, `.standard_content`,
  `.content_price_check`, `.hq_code`, `.standard_code`, scoped by
  `approach`), `msg.agency.first_touch`, and `.example` (a bad draft and a
  better one). They are edited, checked, and approved like any other block
  (D44, D46).
- **The agent reads them** through `get-messaging-guide`, which returns the
  shared rules plus the lead's class. The skill now says how to gather,
  classify, and save; how to write is the playbook's.
- **Messaging follows the current playbook,** not the lead's pinned release:
  a Playbook edit applies to the next draft on any lead, old or new, and the
  lint in `save-draft` checks against the same rules. Rules and routing
  stay pinned. The draft receipt cites the message rule versions it used.
- The price anchor and customer evidence stay in the Sales handbook; the
  blocks point to it.

## D66. Routing is the handoff after triage, not the owner (2026-09-30)

- Fred: "Routing occurs after the lead is processed. The lead is routed from
  the PA to the AE after a set criterion is met." A good enterprise fit gets
  an email with the AE's meeting link to speed up the sales process; a lead
  with potential that is not an enterprise fit is the PA's call, with the
  PA's own meeting link.
- **Owner and route are separate.** The owner is the PA HubSpot assigned
  (what PA used to call routing; the playbook section is now Ownership, and
  the lead page says "Owner X, assigned in HubSpot"). The route is new and
  comes after triage.
- **Routes:** route to the AE, PA takes the call, qualify first (questions,
  no link), the agency path, their AE and CSM (customer), the deal's AE
  (open deal), and no sales email (support, educational, junk).
- **The rule is a playbook block,** `rule.routing.by_class` in the new
  Routing section: Highly Qualified Content and Code go to the AE; Standard
  and the price check qualify first; agencies take the agency path. Fred
  approved this starting mapping. The PA overrides it per lead
  (`set-lead-route`, people only): the AE, the PA's own call, or qualify
  first. Customers, open deals, and non-sales exits are not overridable.
- **Which AE:** the company's HubSpot owner when that owner is not a PA,
  else the PA's pod AE. Fred chose this.
- **Meeting links:** Fred chose "link only". The meeting link is the ask,
  with no day suggestions; this replaces "no calendar links, offer
  Wednesday or Thursday" (D62). Links, roles, and pod AEs are team data on
  the Team page (`pa_people`, migration v10), never in source. A missing
  link or pod AE is named on the lead, and the draft uses `[meeting link]`.
- **Drafts follow the route.** `save-draft` lints against it: a meeting
  route must carry that exact link, a qualify-first route carries none. The
  draft records the route and link it was written for; when either changes
  (an override, a new link, a new pod AE) the agent rewrites it.
  `DRAFT_RULES_VERSION` is 3, so every undecided draft is rewritten once.
- Not changed: nothing is sent and nothing is written to HubSpot.

## D67. Qualification is Exceptional or Requires discovery (2026-10-01)

- Fred: an exceptional lead routes to the AE; anything less is marked
  "requires discovery". This replaces Highly Qualified and Standard (D61)
  for both Content and Code; Content or Code now only picks the email angle.
  Agencies still go first, and the Content price check stays.
- **Five signals,** each met, not met, or unknown, with evidence:
  intent score (HubSpot Company Fit Score, Breeze, 0 to 10) of 6 or more; a
  clear enterprise need in the inbound message; 101 or more employees
  ("over 100"); a clearly defined budget (the form says Approved, or the
  message names one; blank is unknown and may need research); multiple
  sign-ups from the account (company property Number of Associated Sign Up
  Contacts, 2 or more).
- **Exceptional at 3 of 5** (Fred chose 3). Below that, Requires discovery.
- **Intent score bands** (Fred): 0 to 1 suggests a recycle (the decision
  recommendation becomes decline and recycle; the PA decides), 2 to 5 is
  discovery, 6 to 10 is the exceptional signal.
- **The thresholds are a playbook block,** `rule.qualify.tiers` in the
  Qualification section, enforced by `server/core/qualify`. The class
  codes (`hq_*`, `standard_*`) stay so saved drafts keep their class; their
  labels are Exceptional and Requires discovery. Routing by class (D66)
  already sends the `hq_*` classes to the AE.
- PA reads the sign-up count with the company (read-only). Older leads get
  it on their next refresh; until then the signal is unknown.

## D68. The first touch is the first email only (2026-10-01)

- Fred: the first touch section showed the latest touch, not the first.
- Cause: the history read only the newest emails on a contact, so on a busy
  contact the real first email was not in the list, and the earliest of the
  newest was shown. It also counted from the latest form, not the first.
- Now every email on the contact is read (paged, bounded) to find the first
  one sent after the engagement's first form. The list below still shows
  the newest. Leads whose first touch was recorded before this are checked
  once and corrected when an earlier email is found.
- 2026-10-01 follow-up (Fred: "First touch is still showing the email
  thread"). On that lead the first email was never logged on the contact;
  only the reply thread was, and PA showed our reply to a colleague (the
  lead on CC) as the first touch. A first touch is now addressed to the lead
  (To, not CC) and is not a reply or forward. When only a thread is logged,
  PA says the first email is not in HubSpot and uses the thread's earliest
  email as proof of contact for the SLA timer. Reply headers that wrap over
  lines and quoted `>` lines are dropped from email text. Recorded first
  touches are rechecked once under these rules.

## D69. QL is a stage, not a verdict, and after QL comes SAL or Recycle (2026-10-01)

- Fred: "If it's an inbound lead it will always come in as a QL. QL is just
  a stage in the Lifecycle, not a determination or a level of
  qualification." And: "a lead could go to SAL or it could go to Recycle."
- The badge no longer says "Qualified lead" or "Verdict QL". It says the
  qualification (D67): Exceptional, Requires discovery, or Suggest recycle.
  The scorecard's `ql` read is labeled "Sales request" where it still shows.
- The sales cycle marks QL on arrival for every sales lead. The next stage
  reads "SAL or Recycle"; when HubSpot's lifecycle is Recycle, or the rep
  declines and recycles in PA, that stage shows Recycle and the cycle stops.
  Disqualified and Excluded stop it the same way.
- The decision recommendation follows the qualification, so it never says
  "accept and sequence" while the class suggests a recycle. Open decisions
  show PA's current recommendation, not the one saved when they were made.

## D70. New leads are read from HubSpot again once HubSpot has finished them (2026-10-01)

- Fred flagged a lead whose owner, intent score, name, and message did not
  match HubSpot. PA read it within a minute of the form; HubSpot assigned
  the owner four minutes later, then filled the Breeze score, and the
  questionnaire came an hour after that. PA kept its first read.
- Each new lead is now read again about 10 and 60 minutes after its form
  (within 3 hours), while nobody has acted on it: no decision made, no route
  override, no first touch. A refresh restarts triage, so acted-on leads are
  left alone; "Refresh from HubSpot" still works on any lead.
- The classification card shows the whole form message as written, with
  the question PA picked out of it underneath, so it reads like HubSpot.

## D71. Answer what they asked, no lectures, and no score means one clarification email (2026-10-01)

- Fred: the drafts "sound a bit preachy" and do not address "the questions
  and specifics of the message". On the example lead the draft ignored the
  call, the demo, and the pricing they asked for, restated their message,
  told them what "the hard part" is, and asked three questions. Part of that
  came from PA's own lint, which nudged every draft toward a "teams like
  yours" line and required Standard leads to ask two or three questions.
- **Messaging (playbook):** answer every ask first (a call, a demo,
  pricing, a plan); the connection line uses their specifics and is skipped
  rather than lecturing; no "teams like yours usually find" or "the hard
  part is" (now banned phrases); at most two questions. The worked example
  now shows a lead asking for a call, a demo, and pricing.
- **Lint:** the peer-connection nudge is gone; more than two questions is a
  problem, and so is a no-link route with no question; an ask in their
  message (call, demo, pricing) that the draft does not answer is a
  problem (`unanswered_ask`). `DRAFT_RULES_VERSION` is 4, so undecided
  drafts are rewritten.
- **No intent score counts as 0** (Fred), so it suggests a recycle. Those
  leads take a new route, **One clarification email** (`clarify_once`): a
  single short email asking them to clarify what they need, not a sequence
  and no meeting link; with no reply, it recycles. The decision
  recommendation is decline and recycle. The PA can still pick another route.
  The playbook has a block for it (`msg.first_touch.clarify`).
- Demo and synthetic fixtures carry made-up fit scores so they still show
  the full range.

## D72. Exceptional leads loop in the AE, and a missing meeting link is asked for once (2026-10-01)

- Fred: "For exceptional leads, make sure to loop in the AE, and reference
  them in the email. Suggest the meeting and the intention behind the
  meeting then offer the AE meeting link clearly."
- On Route to the AE (and the deal's AE), PA puts the AE on CC; the draft
  card shows the Cc line. The email names the AE, suggests the meeting and
  what it is for in the lead's terms, then gives the AE's link on its own
  line. The lint checks the AE is named (`ae_named`), ignoring links.
  The Exceptional message blocks say the same. `DRAFT_RULES_VERSION` is 5.
- Fred: "If there is no meeting link, add a one-time field somewhere to add
  a meeting link, that link will be saved and associated with whoever the
  lead was routed to. It should not prompt the user again." The Route box
  on the lead shows "Add <name>'s meeting link" when the routed person has
  none (`set-meeting-link`, people only). It saves to that person (keeping
  their role and pod AE), so every lead routed to them uses it and the
  field never shows again; drafts are rewritten with the link.

## D73. A refresh keeps what is already done (2026-10-01)

- Fred saw a finished lead "revert" to "Waiting for the agent" with no
  owner and no draft. The 10 minute follow-up read (D70) refreshed it, and a
  refresh started a fresh run that waited for the agent to read the message
  again.
- A refresh now carries over the message assessment when the message is
  unchanged, so routing, scoring, and the class run straight away; the
  latest draft, which the agent rewrites only if the route or rules
  changed; and any route the PA picked. A changed message still goes to the
  agent.
- 2026-10-01 follow-ups. (1) A "Re:" subject no longer disqualifies a first
  touch: reps reply to the form notification itself, and that is the first
  email. Only an email the lead is not addressed on (a CC) is excluded.
  The not-logged card also shows the thread's earliest email. Recorded
  first touches are rechecked under this rule. (2) When an exceptional lead
  has no AE at all (no account AE, no pod AE), the Route box asks once "Who
  is <PA>'s AE?": pick or type the AE and their link; it is saved as the
  PA's pod AE, so their next enterprise leads route there.

## D74. A page load reads each record once, and a failed access check is retried (2026-10-01)

- Fred hit "Couldn't load this lead. You do not have access to this
  workspace app." His access was fine. On every request the framework asks
  Dispatch whether the user may use PA, with a 2.5 second timeout, and
  fails closed; a slow answer reads as "no access".
- PA made that more likely: the inbound list (which the lead page also
  loads, for next and previous) took 5 to 6 seconds and about 2,600
  database reads, because the class, the route, and the live
  recommendation (D66, D67, D69) each re-read the same records per lead.
- Each board and lead build now reads through a per-request cache
  (`withReadCache`), so a record is read once per page load. Results are
  copies, and failed reads are not cached.
- The board and lead queries retry a transient access, auth, or network
  error up to three times before showing it.
- Not changed: the framework's access check itself. Caching its positive
  answers would need a framework patch, which the repo allows only for a
  confirmed upstream bug; that is a follow-up if the error comes back.

## D75. The board shows the first email sent from HubSpot (2026-10-01)

- Fred: leads actioned in HubSpot showed "No draft needed" on the board;
  the sent email should show like the drafts do.
- The board reads only PA's data, and the email lived in HubSpot. When the
  history check finds the first touch (or the reply thread that proves
  contact), PA now saves a short copy: subject, a 300 character preview
  without the greeting, sender, recipients, and when it was sent (event
  `first_touch.email`, once per email). The board shows it with a "Sent
  from HubSpot" chip. Leads already detected are rechecked once to fill it.

## D76. The owner or a Playbook admin approves playbook edits (2026-10-01)

- Fred: "Edits to the playbook should not go to revops, it should go to me
  the owner, or an admin that I set." This replaces owning-team approval
  (D44) for playbook changes.
- A new playbook role, **Playbook admin**, is assigned on the Team page by
  the owner. Every change needs one approval from the app owner or a
  Playbook admin. The owner can approve any change, their own included; an
  admin approves anyone's but their own. RevOps and the PA team still draft,
  check, and submit, and entries keep their owning team as who to ask.
- Changes already in review that named RevOps or the PA team now wait on
  the owner or an admin instead. A Playbook admin sees the same
  suggestions as the owner.

## D77. Commercial accounts go to the commercial AE (2026-10-01)

- Fred: "a commercial account (defined in the playbook as a company below
  8k employees) goes to the commercial AE."
- Choosing the AE for Route to the AE is now: the account's own AE in
  HubSpot first; else, for a commercial account, the Commercial AE; else
  the PA's pod AE. A company is commercial when its employees (HubSpot
  company, else the form's company size) are under the line; an unknown
  size is not assumed commercial.
- The line is a playbook block, `rule.routing.commercial` (Routing,
  `max_employees: 8000`). A release published before the block existed
  uses 8,000; retiring the block turns commercial routing off.
- The Commercial AE is a role on the Team page (People and meeting links).
  With none set, a commercial lead's Route box asks once who it is and for
  their meeting link. The Route box marks the lead as a commercial or
  enterprise account, and the commercial AE is looped in on the email like
  any AE (D72).

## D78. AE routing: AE owner, Commercial AE, or the Enterprise AE round robin (2026-10-01)

- Fred's rule for an exceptional lead, replacing D77's ordering and the PA
  pod AE (D72):
  - Owned by an AE in HubSpot: route to that AE owner.
  - Not owned by an AE, 8,000 employees or fewer: route to the Commercial AE.
  - Not owned by an AE, more than 8,000 employees: round robin to an
    Enterprise AE.
- The line is "or fewer" now (`max_employees` is inclusive). An unknown
  employee count goes to the enterprise round robin and the lead says to
  check the size.
- **Round robin:** the Enterprise AE given the fewest leads, then the one
  given a lead longest ago. The minute sweep saves each pick
  (`pa_ae_assignments`, migration v11) before drafts are written, so a lead
  keeps its AE and the rotation stays fair; until it is saved, the lead
  shows who is next up. A refresh carries the pick over without counting it
  again.
- **People:** the Team page roles are PA, Enterprise AE (the round robin),
  Commercial AE, and CSM. The pod AE column is gone; stored pod AEs are no
  longer used. With no Enterprise AE or no Commercial AE set, the lead's
  Route box asks once for one.
