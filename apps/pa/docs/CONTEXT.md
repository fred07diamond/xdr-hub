# Context

Why this app exists and the principles it is built on. The long-form
reference is Fred's private "PA agent app: evaluation and build reference"
page; this file carries what a coding agent needs from it.

## Who and what

- **Owner:** Fred Diamond, xDR and GTM engineer at Builder.io. He built
  Builder.LI (LinkedIn prospecting, used by 13+ colleagues), a booking agent,
  and ICP scoring, all in the xDR Hub workspace.
- **Users:** Product Advocates (PAs), who work inbound and product-signup
  leads, plus AEs, partner reps, the PA lead, RevOps, and PMM.
- **Source workflow docs:** Contact Sales, Product Signup, Expansion,
  Qualification Matrix, and the two agent roadmaps. The Contact Sales steps
  this slice implements:
  - **1a Trigger:** the form submission.
  - **1b Pre-check:** QL, recycle, or disqualify. Support goes to support,
    students to self-serve, sellers and junk are ignored, restricted
    countries are disqualified, and existing deals, customers, and owned
    accounts go to their owner.
  - **1c Route and scorecard:** owned leads go to the owner, unowned to
    round robin. The scorecard answers the matrix with a source per answer.
  - **1d Immediate email:** answers any real question directly, with the
    calendar link as the call to action.
  - **2b Decision:** the rep decides QL to SAL within 24 hours.
- **Qualification Matrix questions used at this stage:** 1 (real person, real
  company), 2 (what the company does and at what scale), 3 (role, partial),
  4 (which product, partial), 5 (the pain in their words), 8 (self-serve or
  enterprise shaped, as a hypothesis), 11 (product activity), and 12
  (relationship state: new, customer, churned, agency, open deal).

## How inbound runs today (xDR Playbook, Notion, August 2026)

Read from the team's xDR Playbook (Overview, Quick Reference, Shared
Workflows, Inbound, Glossary; see `SOURCES.md`). Where this differs from the
rest of the kit, it is recorded in `DECISIONS.md` D43.

- **Contact Sales is already automated by Dobby** for accounts with no AE
  owner. Dobby decides SAL or Recycle and sends right away: SAL gets a
  personalized first message with the inbound xDR's calendar link and is
  enrolled in the "Automated Qualified Handraise" HubSpot sequence; Recycle
  gets a qualify-out message and the "Automated Recycle Handraise" sequence.
  There is no 30 minute SLA and no open queue.
- **The inbound xDR's job** is to monitor the Slack channel and catch good
  leads that were wrongly recycled, work the sequence call steps in Nooks,
  and take the intro calls that book. A Claude project then recommends take,
  pivot to an AE, or disqualify.
- **AE-owned Contact Sales is unchanged:** the AE messages the lead directly.
  Contact Sales on an outbound-owned account goes to the owning xDR.
- **Ownership lives in three HubSpot owner fields** (contact owner, company
  owner, xDR owner). Enterprise: company owner is an AE and the xDR owner is
  empty, route to the AE; the xDR owner is set, route to that xDR; the
  company owner is an xDR, route to that xDR; no owner, round robin to an
  Enterprise xDR. Commercial: the company owner is an xDR, route to them;
  otherwise round robin to a Commercial xDR. Commercial accounts are not
  AE-owned before a meeting is booked.
- **Segments:** Enterprise is 4,000+ employees, Commercial 0 to 3,999.
- **Agencies turn on one question, "who is the end user?"** The agency
  itself: size the agency and use the territory AE round robin. A named
  client: get the client's headcount and HQ, use the territory AE round robin
  for the client, and always loop in Partnerships. No end user: route to
  Partnerships. When the client's size is unknown, the first touch must ask
  for it.
- **Five AE round robins** (by segment and region) are for booking the
  meeting after qualification, not for the first touch.
- **Product bars:** Builder Content has no self-serve plan, so every Content
  Contact Sales lead is buying intent and junior titles do not disqualify.
  Builder Code has self-serve plans; the bar for an AE is more than 20 seats,
  an enterprise-only feature (SSO, RBAC, self-hosted git), or enterprise
  firmographics. Headless CMS trial requests qualify at 1M+ page views a
  month or a large, established company.
- **Do not engage** Cuba, Iran, North Korea, Syria, Russia, Belarus, Crimea,
  Donetsk, or Luhansk (Stripe and Builder policy).
- **Other rules that touch drafting:** check a contact is not already in an
  active sequence before enrolling; no customer meetings on PG Tuesday; say
  "Account Director," never "Expert"; "if it is not in HubSpot, it didn't
  happen."

## The building guidelines

1. Nouns first, agents second. Navigation follows accounts, contacts,
   engagements, and work items.
2. One front door. Every agent output arrives as a work item with one
   recommended action. No agent gets its own alert stream.
3. Not everything called an agent should be one. Use code where the path is
   fixed.
4. One writer per field. Qualification alone writes the scorecard.
5. Autonomy is a policy table, not a sentence.
6. Review changes, not documents, in batches.
7. Every claim carries a receipt: source, freshness, confidence.
8. Precompute, then refresh just in time. Reps never wait on a model.
9. Treat everything from outside as untrusted.
10. Business rules live in the playbook's versioned rule entries.
11. The CRM is a port, not the platform.
12. Every external call goes through a gateway.
13. Every feature earns motivation, ability, and a prompt (MAP).
14. Every playbook change is a release.
15. Every correction is data, with a one-tap reason.
16. Humans own relationships; agents own logistics.

## Behavior design (MAP)

A behavior happens when motivation, ability, and a prompt meet (Fogg). Every
feature gets a MAP card before it is built:

- the target behavior
- the motivation, or payoff
- the ability, as a one-step path
- the prompt
- the payoff echo
- a measure and a kill bar
- an owner

Anything under its bar after two fix cycles is fixed or cut.

Prompts have a budget. Alert fatigue is real, so tier the prompts, cap them,
and update in place.

## Playbook principles

- Split rules (evaluated in code) from guidance (loaded for the agent).
- Entries have an owner, a scope, a version, a status, a rationale, examples
  that double as eval cases, sources for claims, review-by dates, and a
  precedence tier.
- Versions are immutable; labels move. Releases are whole snapshots.
- Every decision pins its release, and receipts come from tool calls, not the
  model's own account.
- Precedence: compliance and rules of engagement, then motion rules, then
  definitions and plays, then persona and house message rules, then the rep's
  personal voice.

## Test-first roadmap

1. Name the riskiest assumption.
2. Test it the cheapest way.
3. Build the thinnest slice.
4. Release to design partners.
5. Measure.
6. Scale, fix, or cut.

Rhythm: a weekly design-partner session run by the builders, a weekly eval
and correction review, a behavior review every two weeks, gate reviews with
real numbers, and retiring something monthly.

## The Dobby teardown (the example this slice fixes)

An agency asked for an Enterprise trial "for one of my client." They were
already SAL. Dobby:

- Showed four scores on three scales, and a QUALIFIED verdict that
  contradicted its own "too small for Enterprise" flag.
- Sized the agency's own website instead of the unknown client.
- Buried the SAL fact at the bottom, after a cold draft.
- Presented unsourced, contradictory company facts.
- Drafted an email that ignored the trial question, speculated, split the call
  to action, used em dashes, and missed the agency partner program.
- Lived in a 7-reply Slack thread with nothing tracked.

What it got right: it was fast, caught the agency pattern with a quote, left
the lifecycle stage alone, and asked who the client was.

## Lessons from xDR Hub (do not repeat)

- One person existed in four tables with separate scoring paths. Here there
  is one contact and one engagement, and history lives in events.
- The Apollo credit guard stopped at one app's boundary. Here every call goes
  through the gateway.
- A feature shipped two days after a decision that forbade it (auto-connect
  versus "never auto-sends"). Here decisions are enforced in code and tests,
  not only in docs.
- The sweep ran on request traffic. Here it runs on a durable scheduled
  trigger.
- There was no usage instrumentation. Here the event log comes first.
- Features that fed the rep's existing loop survived; web-only features with
  no prompt died. Here the Slack card is the prompt and the app is the record.
