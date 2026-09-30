# PA App, Slice 1: Inbound. Product Requirements

- **Status:** Draft v1, 2026-09-29
- **Owner:** Fred Diamond (xDR, Builder.io)
- **Reviewers:** PA lead, RevOps, Sales leadership, PMM
- **Read with:** `CONTEXT.md` (background), `SPEC.md` (design),
  `OUTLINE.md` (build order), `DECISIONS.md`

## 1. Summary

The PA app starts with one job: handle every inbound Contact Sales lead from
form fill to first human touch, and track it after.

Each submission becomes a single engagement. It is pre-checked against rules,
routed to the right owner, scored with a sourced scorecard, and given a draft
first touch that answers what the person asked. The owner gets one Slack
message that updates as the lead moves, and the same item lives in the app.
Every decision carries a receipt.

It replaces Dobby. Its foundations (objects, event log, playbook, provider
gateway, CRM port, prompt router, receipts) are what every later PA tool
builds on.

## 2. Problem

Dobby grades inbound leads and posts research and a proposed email into a
Slack thread. One real example, an agency asking for an Enterprise trial for
an unnamed client who was already SAL, shows the failures:

- **The verdict contradicted its own evidence.** "Too small for Enterprise,"
  agency at 88%, and fit 5/10 all led to QUALIFIED, with four scores on
  different scales and no reason given.
- **It sized the wrong company.** It used the agency's own website traffic and
  headcount instead of the unnamed client's.
- **The most important fact came last.** "Already SAL" appeared after a cold
  first-touch draft for a lead someone had already accepted.
- **Facts contradicted each other,** and none had a source or a date.
- **The email ignored the request.** It never addressed the trial, speculated
  about the person's situation, split the call to action, and missed the
  agency partner path.
- **Slack did a database's job.** Seven replies, truncated details, a draft in
  a code block to copy elsewhere, and no record of pickup, send, or outcome.

The team's own Contact Sales workflow doc already specifies the fix: pre-check
first, route on ownership, fill the scorecard with a source per answer, and
answer real questions directly with the calendar link as the call to action.

Speed matters: HBR's audit found firms that tried to contact leads within an
hour were nearly seven times as likely to qualify them (see `SOURCES.md`).

## 3. Goals and non-goals

Targets are proposals until the Milestone 0 baseline is measured.

| ID  | Goal                           | Measure                                                     | Proposed target                         |
| --- | ------------------------------ | ----------------------------------------------------------- | --------------------------------------- |
| G1  | Faster first touch             | Median minutes from submit to first touch, working hours    | Beat Dobby's baseline by 50%            |
| G2  | Right person, right move       | Route and verdict accuracy against the labeled set          | 95% route, 90% verdict                  |
| G3  | No cold touches on owned leads | Cold drafts or sends for owned or active leads              | 0 (guardrail)                           |
| G4  | Nothing falls through          | Submissions with state, owner, and clock visible            | 100%                                    |
| G5  | Trust grows from data          | Approve-without-edit rate; edits with a reason              | Tracked weekly; reasons on 80% of edits |
| G6  | A foundation, not a feature    | Later tools reuse the core modules without contract changes | Checked at the first branch after M3    |

**Non-goals for this slice:** auto-send at any tier; LinkedIn; paid enrichment
by default; multi-step sequences; meeting prep; AE handoff; expansion; the
product signup motion beyond attaching its signals; a Salesforce adapter (the
port is built, only HubSpot is implemented); dashboards beyond the inbound
board and pipeline health; rebuilding Dobby feature for feature.

## 4. Users and roles

| Role                  | Needs from this slice                                                                          | Can do                                                                             |
| --------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Product Advocate (PA) | One message per new lead, a draft that answers the ask, a clock, one view of all their inbound | See own and team inbound; approve, edit, and send own drafts (M2); mark "not mine" |
| AE                    | Leads tied to their open deals or customers, with context                                      | Same as PA, for leads routed to them                                               |
| Partner rep           | Agency and SI leads with the end-client question up front                                      | Same as PA, for the agency route                                                   |
| PA lead               | SLA risk, misses, and routing mistakes                                                         | See all; reassign; receive breach alerts                                           |
| RevOps                | Change rules with versioning and a preview of the impact                                       | Edit rule entries (by pull request in this slice); set account flags               |
| PMM and enablement    | Own message rules and knowledge entries                                                        | Edit guidance entries (by pull request in this slice)                              |
| Admin (Fred)          | Modes, design partners, pipeline health, replays                                               | Everything                                                                         |

## 5. Functional requirements

Mapped to the Contact Sales workflow doc (steps 1a to 1d) plus the fixes
above. P0 must ship in its milestone, P1 should, P2 is later.

**FR-1 Intake (M1, P0).** Receive each Contact Sales submission from HubSpot,
verify it came from HubSpot, and store it exactly once even when HubSpot
retries. Acknowledge fast and do the work afterward. A polling backstop
catches anything the webhook missed.
_Acceptance:_ duplicate deliveries create one engagement; forged requests are
rejected; a missed webhook is picked up within 15 minutes.

**FR-2 Identity and dedupe (M1, P0).** Resolve the person and company from the
normalized email and domain. Attach the submission to an existing open
engagement when there is one. Personal email domains are flagged, never
treated as the company.

**FR-3 CRM snapshot and pre-check (M1, P0).** Read lifecycle stage, owners,
open deals, customer status, recent activity, and product signals through the
CRM port, each with its fetch time. Then apply the playbook's pre-check rules
before any research: support request, educational, selling to us, junk,
restricted country, undeliverable email, existing deal or customer, owned
account, active conversation with someone on our side. Outcomes: attach to the
existing owner, route to support, self-serve thank-you (template, M2), ignore
with the reason logged for the weekly spot check, or continue.
_Acceptance:_ the "already SAL" example produces "attach to existing owner"
with the new ask, never a cold draft.

**FR-4 Message understanding (M1, P0).** Read the form message as untrusted
data and extract: intent, an agency or SI signal with the exact quoted
evidence, whether the end client is named, product interest, language, and
the explicit question if there is one. Any quote that is not verbatim in the
message rejects the result.

**FR-5 Relationship state and routing (M1, P0).** Compute the relationship
state (new, customer, churned, agency, open deal, owned) and route by rule:
existing active owner, then deal or customer owner, then the partner rep for
agencies, then round robin among available PAs. Start the first-touch clock at
submission time and record the route reason.

**FR-6 Scorecard and verdict (M1, P0).** Qualification is the only writer of
the scorecard. It answers the matrix questions this stage can answer, each
with a source, date, and confidence, and returns one verdict (QL, recycle,
disqualify, attach to existing, route elsewhere) with reason codes. Enterprise
fit is a hypothesis sized on the right entity: for an agency buying for an
unnamed client, it is "unknown until the client is named." Conflicting facts
are shown with their sources, never silently merged.

**FR-7 Draft first touch (M1 draft only, M2 send, P0).** Follow the playbook's
message rules: answer the explicit question first from sourced knowledge
entries, one call to action, no speculation about the person's situation,
house style (no em dashes), the prospect's language. When the answer needs
knowledge we don't have, the draft says what will be confirmed and the gap is
flagged to that knowledge entry's owner. No draft is generated for leads
attached to an existing owner unless that owner asks for one.

**FR-8 Notify (M1 shadow channel, M2 owners, P0).** One Slack message per
engagement to its owner: who, what they asked, the route and why, the next
step, the clock, and buttons (Open record in M1; Approve draft, Edit, and Not
mine in M2). The message updates in place as the lead moves. A reminder goes
as a thread reply only when the clock is at risk, and breaches go to the PA
lead. Untrusted text is escaped, and links don't unfurl.

**FR-9 Act (M2, P0).** Approve and send from Slack or the app. Edit inline
with a one-tap reason (tone, wrong fact, wrong person, wrong timing, other).
"Not mine" reassigns with a reason. Sending goes through an approval gate and
an outbox, so a retry never sends twice, and the sent email is logged to
HubSpot.

**FR-10 Track (M1, P0).** An inbound board lists every engagement with state,
owner, clock, route reason, and last event, filterable by mine, team, at risk,
and breached. The engagement record shows the timeline, the scorecard with
sources, the draft history, and receipts. States: new, prechecked, routed,
awaiting first touch, first touch sent, replied, meeting booked, QL, SAL,
recycled, disqualified, attached, closed.

**FR-11 Learn (M0 labels, M2 corrections, P0).** A labeling view records the
expected route, verdict, and first move for historical and live submissions;
labels feed the evals. Every edit, override, and reassignment captures a
reason, linked to the receipts and playbook entries involved.

**FR-12 Operate (M1, P0).** Modes: shadow (no owner notifications, no writes),
live for design partners, live for all, switchable without a deploy. Pipeline
health shows throughput, failures, stuck items, latency, and cost per inbound.
Any submission can be replayed through a chosen playbook release.

## 6. Experience principles

- One recommended action per item, with the most decision-relevant facts
  first.
- Short: the Slack card fits a phone screen without "Show more."
- Every claim links to its source, and unknowns say "unknown," never a guess.
- Update in place. Interrupt only when a person must act now.
- AI-labeled buttons open the agent sidebar with context. No decorative AI
  icons.

## 7. Autonomy for this slice

| Action                                               | Level                        | Approver          | If nobody acts                           |
| ---------------------------------------------------- | ---------------------------- | ----------------- | ---------------------------------------- |
| Create or attach an engagement, compute state, route | Act and notify               | None (rules)      | n/a                                      |
| Ignore junk or vendor pitches                        | Act and notify               | Weekly spot check | Stays ignored, visible in the spot check |
| Self-serve thank-you for students (M2)               | Draft for approval, template | PA lead           | Not sent                                 |
| Scorecard and verdict                                | Suggest, in the app          | Owner             | Stays a suggestion                       |
| Lifecycle or scorecard writes to HubSpot (M3)        | Draft for approval           | Owner             | Not written                              |
| Send the first touch (M2)                            | Draft for approval           | Owner             | Clock escalates; never auto-sends        |
| Slack notifications                                  | Act, by router rules         | None              | n/a                                      |

The Contact Sales doc's auto-send fast lane (step 1d) is deliberately
deferred. It becomes an earned grant, decided from M2 data on
approve-without-edit by segment, and recorded in `DECISIONS.md` (D15).

## 8. Metrics and behavior design

**MAP card for the slice**

- **Target behavior:** the owner sends a first touch from the Slack card or
  the app within the clock.
- **Motivation:** meetings from inbound and speed credit. The card shows
  "Sent 12 min after submit."
- **Ability:** one tap to approve, inline edit, everything on one screen.
- **Prompt:** one DM per new lead, one thread reminder at risk, breaches to
  the PA lead.
- **Payoff echo:** the card updates to Sent, then Replied, then Meeting
  booked.
- **Measure and kill bar:** time to first touch against the baseline. If it
  isn't better after two fix cycles in M2, stop and rethink before M3.

**Metrics, all computed from the event log:** time to card; time to first
touch; clock hit rate; route and verdict accuracy against labels; cold touches
on owned leads (must be 0); approve-without-edit; edit reason mix; "not mine"
rate; meetings booked by route; pipeline failure rate; p95 latency; cost per
inbound; Slack prompts per rep per day.

## 9. Rollout and gates

Details are in `OUTLINE.md`.

| Milestone                   | What ships                                                                                       | Gate to continue                                                                                            |
| --------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| M0 Foundations and baseline | Workspace, schema, CRM reads, playbook v1, labeling, baseline from Dobby's history, eval harness | 50 labeled submissions; baseline recorded; rules agree with labels at 90% offline                           |
| M1 Shadow                   | Full pipeline on live traffic, cards to a private shadow channel, inbound board, receipts        | Two weeks: 99% processed; route 95%; verdict 90%; zero cold drafts on owned leads; p95 card under 2 minutes |
| M2 Design partners          | Owner DMs, approve, edit, send via Gmail, HubSpot logging, corrections, clocks                   | Time to first touch beats the baseline; no guardrail breaches; partners prefer it                           |
| M3 Replace Dobby            | All PAs, Dobby off, CRM write proposals, spot checks, runbook                                    | Two stable weeks at full volume                                                                             |

## 10. Risks and mitigations

| Risk                                     | Mitigation                                                                                  |
| ---------------------------------------- | ------------------------------------------------------------------------------------------- |
| The HubSpot plan lacks workflow webhooks | App webhooks with the v3 signature, or the polling backstop; confirm the tier in M0         |
| Wrong routing annoys owners              | Shadow first; the labeled set; "not mine" with reasons; route receipts                      |
| Alert fatigue                            | One message per lead, updated in place; prompt caps; quiet hours with a fast-lane exception |
| Prompt injection through form text       | Treated as data; narrow tools; verbatim-quote validation; no URL fetching from form text    |
| Drafts that read as AI-written           | Message rules, lint, and evals built from real edits                                        |
| Rules change weekly                      | Playbook releases pinned per engagement, receipts, and an eval gate on changes              |
| Framework changes before 1.0             | Pinned version; deliberate upgrades with codemods and doctor                                |
| Running beside Dobby confuses people     | Shadow channel only in M1; design partners told in M2; Dobby off per person at M3           |
| Personal data spreads                    | Synthetic fixtures, minimal logging, retention limits on raw payloads                       |

## 11. Open decisions

| Decision                                    | Proposed                                                                                         | Owner              | Needed by |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------ | --------- |
| HubSpot ingestion path, given the plan tier | Workflow webhook with request signature                                                          | Fred with RevOps   | M0        |
| First-touch clock and working hours         | 60 minutes in the owner's working hours; outside them, the clock starts at the next working hour | RevOps and PA lead | M1        |
| Agency model                                | Engagement attribute plus an agency flag on the account                                          | RevOps             | M1        |
| Who owns agency and SI leads                | Partner rep                                                                                      | Sales leadership   | M1        |
| When an SAL counts as stale                 | No activity in 90 days                                                                           | RevOps             | M1        |
| Trial path for partner-led evaluations      | PMM writes the knowledge entry                                                                   | PMM                | M1        |
| Design partners                             | 3 to 5 PAs                                                                                       | PA lead            | M2        |
| Send channel                                | The owner's Gmail, logged to HubSpot                                                             | Fred               | M2        |
| Auto-send grant criteria                    | Decided from M2 data                                                                             | Sales leadership   | After M2  |

## 12. What branches from this

| Later tool                          | Reuses                                                    | Adds                                                   |
| ----------------------------------- | --------------------------------------------------------- | ------------------------------------------------------ |
| Product signup motion               | Engagement (motion attribute), pipeline, router, playbook | Signup trigger, consultative play                      |
| Research                            | Evidence, receipts, gateway budgets                       | Deep research agent, paid enrichment behind a decision |
| Outreach sequences                  | Outbox, drafts, clocks, message rules                     | Cadences, send windows, reply handling                 |
| Meeting prep and follow-up          | Engagement timeline, scorecard                            | Meeting room, call ingestion                           |
| AE handoff                          | Scorecard, router, approvals                              | Handoff note, tiger team rules                         |
| Account monitor and expansion       | Accounts, signals, playbook                               | Pod room, expansion plays                              |
| Today queue                         | Work items from every module                              | Ranking and batching                                   |
| Playbook editor and earned autonomy | Releases, evals, receipts                                 | Editor, grants per segment                             |
| Salesforce                          | CRM port                                                  | A second adapter                                       |
