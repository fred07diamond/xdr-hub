# Changelog

## 2026-09-30 (automatic intake and the decision loop)

- New Contact Sales leads come in on their own, about a minute after they
  submit. No button needed (D58).
- Every lead routed to a rep gets a decision with PA's recommendation:
  accept and sequence, decline and recycle, or research more, or what to do
  with a booked meeting. 24 hours to decide; a miss is recorded and flagged,
  nothing happens on its own. "Decide on older leads" covers leads from
  before (D59).
- "Existing owner" is gone as a classification. Owned accounts are
  classified by the lead and get a draft for their owner; open deals and
  existing customers have their own labels.

## 2026-09-30 (real leads)

- PA pulls real Contact Sales submissions from HubSpot (read-only) and runs
  each through triage. The agent reads each message and drafts a reply that
  follows the Sales handbook. Nothing is sent (D54, D55).
- New on the board: "Pull new leads", when HubSpot was last read, and, for
  the app owner, "Turn on the inbound agent" (every 30 minutes).
- Drafts are checked against the handbook's email rules: no colons, under 75
  words when possible, a casual sign-off, no pricing, Builder not Builder.io.
- The Contact Sales response SLA is 30 minutes.

## 2026-09-30 (Sales handbook)

- New Sales handbook page in PA: the sales cycle, qualification, lead
  routing, personas, the email playbook, and sales stages, searchable and
  editable, with every version kept (D53).
- The drafting agent reads the handbook for voice and Contact Sales
  handling; the playbook still decides the rules.

## 2026-09-30 (SLA timer)

- The first-touch clock is now the SLA timer: it marks when a person
  contacted the lead and when it was marked SAL (D51).
- Each lead shows where it is in the sales cycle: MQL, QL, SAL, S0, NBM
  booked, NBM complete, S1.
- "Next step" moved to the bottom of the classification card, after the
  question it answers.
- "Open app" in Dispatch opens PA again (D52).

## 2026-09-30 (triage first)

- Each lead now opens on two things: how it was classified, and the drafted
  reply. The evidence (message, pre-check, route, scorecard, clocks,
  timeline) is one click away under Details (D49).
- The board shows the classification and the draft's subject and first lines
  on every row.
- PA drafts first-touch replies and checks them against the message rules.
  Nothing is sent automatically (D39).
- Inbound handling is the focus; the playbook builder is parked (D50).

## 2026-09-30 (block builder and CRM)

- The playbook is a block builder: drag typed blocks (country lists,
  thresholds, clocks, routing order, message rules, knowledge, the CRM
  mapping) into sections and edit them in place. Edits collect in a draft
  the owning teams approve (D46).
- A new owner-only page stores CRM tokens securely for every xDR Hub app, with
  OAuth for HubSpot and Salesforce (D47).
- Mapping PA's fields to HubSpot is a picker with type checks and suggested
  matches, approved by RevOps (D48).

## 2026-09-30 (dynamic playbook)

- The playbook is now edited in the app at `/playbook`, co-owned by the PA
  team and RevOps: change sets, checks, a replay of the impact, approval by
  the owning teams, and publishing a new release (D44).
- Changes that need something the app or the CRM lacks raise suggestions: a
  build request for the app owner, a CRM field for RevOps, a knowledge gap
  for the PA team. They show in `/suggestions`, the bell, and Slack once the
  PA Inbound app is set up (D45).
- The agent reviews every publish and the week's work, and can only draft and
  suggest.

## 2026-09-29 (xDR Hub merge)

- Merged into xDR Hub as `apps/pa` on the workspace's core 0.176.4 (D33,
  supersedes D1). Removed the standalone `netlify.toml` and release-migration
  script; pinned the toolkit.
- Ported the first build pass (D40). The schema is portable (SQLite locally,
  Postgres in production), JSON goes through one codec, and new integration
  tests run the repository on both dialects.
- Reused workspace infrastructure: the shared HubSpot client and roles (D35).
  Admin rights now come from the shared workspace role.
- Recorded: booking moves into PA later (D36), lead-triage stays separate
  (D37), 0.176.4 checks (D34, D38), and the open auto-respond question (D39).
- Hardened the core after a review (D41): owned accounts and active owners
  are never round-robined, unknowns fail closed, transient errors retry, one
  open engagement per contact, stricter evidence quotes, and untrusted name
  and company text is quoted and scanned. Opened D42 on intent versus
  ownership.
- Read the xDR Playbook in Notion and recorded how inbound runs today
  (CONTEXT) and ten differences from the kit (D43). Dobby already auto-sends,
  which reframes D39.

## 2026-09-30

- Fixed Settings: Integrations no longer freezes in a render loop, and
  "Back to App" returns to the page you came from. (D32)
- Fixed local workspace access: the Builder.io connection, app state, and
  live board data load in the preview again, through a pinned,
  development-only framework patch. (D32)

- Demo mode: a "Demo data" toggle on the Inbound board fills the board,
  records, and receipts with 14 made-up leads run through the real rules in
  the browser. Nothing is saved or sent. (D31)

- Replaced the Fusion starter with the Agent-Native 0.197.0 workspace
  (Dispatch, Chat, and the new `pa` app). Seeds merged. (D16, D17, D27)
- `pa_` schema (17 tables) and additive migrations. (D28)
- Build-time playbook compile to a content-hashed release, `287c16c3`, with
  12 pending confirmations. (D24)
- Core rules with unit tests; deterministic pipeline and synthetic replay.
  All seven seed cases match their expected pre-check, route, and verdict.
  (D20, D21, D23, D26)
- Read actions, `save-message-assessment`, `replay-submission`, and
  `navigation` and `selection` app state.
- Early M1 preview: inbound board, engagement record, receipts drawer, and
  Labels and Ops placeholders, all in shadow mode over synthetic data. (D22,
  D25)
- Route and verdict evals (7 of 7 pass); agent-step evals skipped until M1.
- Worked around two framework dev issues in app config: the agent panel
  crash and the eval CLI loader. Gateway data access needs `A2A_SECRET`.
  (D29)

## 2026-09-29

- Kickoff kit created: PRD, SPEC, OUTLINE, DECISIONS, SOURCES, CONTEXT, and seed files.
- D1 confirmed: a fresh `pa-hub` workspace, not an app inside xDR Hub.
