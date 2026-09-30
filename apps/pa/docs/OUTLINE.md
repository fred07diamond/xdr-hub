# Build Outline and Roadmap

Each milestone lists its scope, tasks, tests, docs to consult, a demo, and a
gate. Check boxes as you go. Never start the next milestone until the gate
passes and Fred says go.

**Current status:** M0 in progress, in xDR Hub at `apps/pa` (D33). The first
build pass (workspace, schema, core rules, deterministic pipeline, synthetic
replay, and an early M1 board preview over synthetic data, D22) is ported onto
core 0.176.4 with a portable schema (D40). No live traffic. Focus is inbound handling
(D50); the playbook builder is parked. Drafts and the triage-first board and
record are built (D49); nothing is sent automatically (D39). Open before M1:
D34 (sweep driver). Open before M2: the D36 check that booking is not
sending Contact Sales first touches.

## Definition of done, for every task

- The four areas are covered where they apply: UI, action, skill or
  `AGENTS.md` entry, and app-state.
- Tests are added and passing. Typecheck, lint, evals, and
  `agent-native doctor` are clean.
- Docs consulted are recorded in `SOURCES.md`, with links at the call sites.
- `DECISIONS.md` is updated for any choice made, with a `CHANGELOG.md` entry.
- Copy has no em dashes or en dashes, and untrusted text is escaped.

## M0: Foundations and baseline (about 2 weeks)

**Scope:** the workspace, the domain core, read-only HubSpot, the playbook,
labels, and the baseline. No Slack posts and no writes of any kind.

- [x] Scaffold per `PROMPT.md`; commit `agent-native.json`; fill in
      `DESIGN.md`. (D16, D17, D27)
- [x] Verify the framework assumptions (sweep hook, agent-step path, Slack
      adapter scope) and record the results (D3, D6, D11). (D18; the D3 path
      is still chosen in M1)
- [x] Port the first pass into xDR Hub on 0.176.4 and re-verify the
      assumptions there (D33, D38, D40). The sweep hook is absent (D34).
- [ ] Choose the sweep driver (D34).
- [ ] Lift the owner-context helper into `packages/shared` (D35).
- [x] First code review of the ported core: G3 routing, retries and claim
      lease, one open engagement per contact, assessment and untrusted-text
      hardening (D41). 90 tests on SQLite and Postgres.
- [ ] Decide whether intent outranks ownership (D42).
- [ ] Reconcile playbook v1 with the xDR Playbook, one confirmed release at a
      time (D43).
- [ ] Batch the board queries before live traffic (D41, deferred).
- [x] The dynamic playbook (D44): database releases and labels, change sets,
      owning-team approvals, checks and impact replay, suggestions with
      in-app and Slack delivery (D45), the agent review and weekly job,
      `/playbook`, `/suggestions`, and playbook roles on the Team page.
- [ ] Assign playbook roles, enable the agent review
      (`enable-playbook-review`), and confirm the 12 pending values through
      changes in the app.
- [ ] Create the PA Inbound Slack app and set `PA_SLACK_BOT_TOKEN` (D45).
- [x] The block builder (D46): block types, sections, drag and drop,
      structured editors, staged drafts, readable diffs.
- [x] CRM connections (D47) and the HubSpot mapping editor (D48).
- [x] Triage first (D49): the draft step with lint, `save-draft`, and a board
      and record that lead with the classification and the draft.
- [ ] Save the HubSpot token on `/crm`, refresh the HubSpot fields, and have
      RevOps map the SAL value and last activity date.
- [x] A HubSpot adapter behind the CRM port that reads the mapping (D54).
- [x] Live intake from HubSpot (poll), the inbound agent, and handbook-aligned
      drafts, in shadow (D54, D55).
- [ ] Fill `config.routing_pool` with the real PAs and create their PA
      profiles, so round robin and SLA timers run for real owners.
- [x] Schema and migrations for the `pa_` tables (SPEC section 4). (D28)
- [x] `server/core` modules with unit tests: identity, objects, events,
      receipts, clocks, playbook (compile, release, resolve), and the
      pre-check and routing rules. (62 tests; CRM port has a fixture adapter
      only)
- [ ] Gateway: limiter, retries, breaker, ledger, and fake providers for
      tests.
- [ ] CRM port and HubSpot adapter (reads only) with contract tests. Confirm
      `hubspot-mapping.yaml` with RevOps using the properties API.
- [ ] Confirm the HubSpot ingestion path and plan tier with Fred (D5).
- [ ] Baseline script, read-only:
  - Pull 60 to 90 days of Contact Sales submissions and first outbound
    email times from HubSpot.
  - Import Dobby threads from Slack, by export or the read-only API after
    consulting its docs.
  - Compute: time to first touch, share of drafts sent as written, verdict
    and flag contradictions, and share of leads already owned.
  - Write the results to `docs/BASELINE.md`.
- [ ] Labeling UI and the `label-submission` action. Label 50 submissions
      with Fred and one PA.
- [ ] Eval harness: wire the framework eval gate and the route and verdict
      scorers, and run the seed fixtures in CI. (Scorers and `pnpm eval`
      done: 7 of 7 seed fixtures pass, agent-step evals skipped until M1.
      Not yet in CI, D29)

**Tests:** unit coverage for rules and clocks; contract tests for HubSpot
reads; the labeled set replayed through the deterministic steps.

**Docs to consult:**

- Framework: `getting-started`, `key-concepts`, `actions-*`,
  `server-database`, `security`, `evals`, `integrations`,
  `workspace-connections`
- HubSpot: the contacts, companies, deals, owners, properties, and form
  submissions APIs
- Slack: the export format, or `conversations.history`, if used

**Demo:** open a labeled historical submission and see its pre-check, route,
and receipts computed offline.

**Gate:**

- 50 labels
- The baseline recorded
- Deterministic routing agrees with the labels at 90% or better
- Fred approves M1

## M1: Shadow (about 2 weeks live)

**Scope:** live intake and the full pipeline, cards posted to a private
shadow channel, the inbound board and record, and receipts. No owner
notifications, no sends, no CRM writes.

- [ ] Intake route: signature verification, inbox, self-fired processor,
      sweep registration, and the backstop poll.
- [ ] Processor: atomic claim, step runner, and halt and retry semantics.
      (Step runner with claim, retry, fail, and halt built and tested; the
      live processor waits for intake)
- [ ] Agent steps (`assess_message` and `draft`) through the chosen framework
      path, with save actions, validation, lint, and runtime skills. (Draft
      step, lint, and `save-draft` built, D49; the processor-run agent path
      waits for D3)
- [ ] Scorecard step, with the verdict and reason codes. (Built and
      replayed on synthetic cases; checked once it runs on labeled data)
- [ ] Prompt router and Slack card (link buttons) to the shadow channel, with
      in-place updates.
- [ ] (Board, record, and receipts drawer previewed early over synthetic
      data, D22; pipeline health and the mode flag not built)
      Inbound board, engagement record, receipts drawer, pipeline health, and
      settings with the mode flag.
- [ ] The failure tests from SPEC section 16, plus a duplicate-storm load
      test.
- [ ] Deploy to the Netlify production site in shadow mode, and verify that
      the scheduled trigger runs the sweep.

**Gate, after two weeks:**

- 99% of submissions processed
- Route accuracy 95% and verdict accuracy 90% against the labels
- Zero cold drafts on owned leads
- Card within 2 minutes at p95
- Draft lint passing at 95%
- Fred and the PA lead sign off

## M2: Design partners (2 to 3 weeks)

**Scope:** design partners get DMs, approve, edit, and send, with
corrections, clocks, and escalations.

- [ ] Slack interactivity route and buttons: acknowledge within 3 seconds,
      handle the work from a queue, then `chat.update`.
- [ ] `send-first-touch` with `needsApproval`, the outbox, Gmail sending
      through the framework's plumbing, and HubSpot email logging.
- [ ] Edit with reason chips, "not mine" with a reason, and a corrections
      table and views.
- [ ] Clock reminders and breach alerts from the sweep.
- [ ] Prompt caps and quiet hours per user.
- [ ] A weekly behavior review report on the MAP card metrics.

**Gate:**

- Time to first touch beats the baseline for design partners
- Zero guardrail breaches: no double sends, no cold touches on owned leads,
  no wrong-recipient sends
- Partners prefer it to Dobby, per a short survey
- Fred approves M3

## M3: Replace Dobby (1 to 2 weeks)

- [ ] Expand to all PAs by flag. Turn Dobby off person by person, then fully,
      in coordination with its owner.
- [ ] CRM write proposals for lifecycle and scorecard fields, approved by the
      owner.
- [ ] Weekly spot check of ignored and disqualified leads (Contact Sales doc
      step 1b).
- [ ] Runbook: on-call checks, replay, rolling back a playbook release, and
      pausing modes.

**Gate:** two stable weeks at full volume, metrics at or above M2, and Dobby
retired.

## After M3: branches

Each branch starts with its own riskiest assumption and cheapest test, then
gets a MAP card, an eval set, playbook entries, and a shadow period before
owners see it.

1. Product signup motion
2. Research, with gated paid enrichment
3. Outreach sequences
4. Meeting prep and follow-up (absorbs the booking app's meetings, D36)
5. AE handoff (absorbs booking's deals and AE lookups, D36)
6. The Today queue across modules
7. The playbook editor
8. Earned autonomy grants
9. A Salesforce adapter, if needed

## Not yet, and what would change that

| Idea                          | Build it when                                                                                         |
| ----------------------------- | ----------------------------------------------------------------------------------------------------- |
| Auto-send                     | A segment's approve-without-edit rate stays above the agreed bar for four weeks with clean guardrails |
| Paid enrichment on every lead | Research shows missing role or firmographics change routing or verdicts often enough to pay for       |
| Dashboards                    | The same question comes up in three weekly reviews and a saved view can't answer it                   |
| LinkedIn steps                | Only if LinkedIn's terms allow it; until then, assisted drafting only                                 |
| A second CRM adapter          | A second CRM is actually on the table                                                                 |
