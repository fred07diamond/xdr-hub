# Builder.LI Outreach App

Purpose: receive a captured LinkedIn profile from the Builder.LI
Chrome extension, score the person against the user's ICP (read
live from selected Notion docs), draft a personalized connection
note, and send it via the extension. See docs/BUILD-GUIDE.md
and docs/DECISIONS.md.

## What the agent does on each captured profile
1. Read the captured fields (name, headline, role, company,
   about, recent activity).
2. Call get-icp-sources. Check the returned `icpText` field.
   - If icpText is null or empty: set verdict to "inconclusive",
     set fit_reason to "No ICP document uploaded — go to the ICP
     tab and upload your ICP criteria to enable fit scoring."
     Do NOT guess, infer, or invent ICP criteria. Do not return
     "strong", "possible", or "weak" without a real ICP document.
     Still draft a generic connection note in step 4.
   - If icpText has content: score fit against it (step 3).
3. Score fit against the ICP document. Return a short verdict
   (strong / possible / weak) with one sentence of reasoning that
   references specific criteria from the ICP.
4. Draft one connection note that references something specific
   and true from the profile, in the voice and targeting defined
   in the ICP doc. Respect LinkedIn's note limit: 300 chars on
   Premium/Sales Navigator, about 200 on free accounts.

## When the user shares an ICP document

Personas are a shared resource across the whole workspace now: they live in
`packages/shared`'s `sharedPersonas` / `sharedPersonaDocs` tables
(`@xdr-hub/shared/server`), not a li-agent-local table — prospecting-hub
reads and writes the same rows. A persona holds MANY ICP documents, not one.
There is no cached `icpText` column on `sharedPersonas`; criteria text is
always computed fresh from a persona's documents via `getPersonaCriteriaText`
(pure read) or persisted-summary via `rebuildPersonaCriteriaText` (call this
one only from doc-mutation actions — add/delete a document — never from a
read/scoring path). `selectPersona`, `selectPersonasBatch`,
`generate-sales-nav-search`, and `get-messaging-graph` all compute criteria
text this way per persona rather than reading a single field.

The old local `icpPersonas` / `icpPersonaDocs` tables still exist in
`server/db/schema.ts` but are legacy/frozen — kept only so historical
`prospects.personaId` / `leadListItems.personaId` / `postEngagements.personaId`
references still resolve until a later cleanup repoints them. Nothing should
read or write those tables going forward.

If the user pastes text or attaches one or more files (.txt, .md, or PDF)
containing ICP criteria:
1. Extract all the text content. Keep each file SEPARATE — one document
   per file, named after the file. Do not concatenate them yourself; the
   rebuild does that, and merging them by hand loses which criteria came
   from which document.
2. Ask which persona they belong to if it isn't obvious (call
   `list-icp-personas` to see the personas and what is already attached).
   - Adding to an existing persona: `add-persona-documents` with
     `{ personaId, documents: [{ name, text }, ...] }`. This ADDS
     alongside whatever is already attached.
   - Creating a new persona from the documents: `create-icp-persona` with
     `{ name, color, documents: [...] }`.
   - Removing one: `delete-persona-document` with `{ id }`.
3. Confirm what was saved: echo a short summary of the key criteria you
   found (target role, company size, signals, etc.) so the user can
   verify it was read correctly.

`update-icp-persona`'s `icpText` argument is DESTRUCTIVE — it replaces
every document on the persona with a single one. Use it only when the
user explicitly asks to replace their ICP, never to add to it.

`save-icp-document` writes the legacy `icpSources` singleton, which is
only a fallback for a workspace with no personas at all
(`select-persona.ts`). Prefer the persona actions above.

Both surfaces expose this: the ICP tab (`app/routes/icp.tsx`) takes
multi-file drops per persona card, and the Chrome extension's side panel
does too, under Settings → ICP Personas. The UI file pickers accept
.txt/.md only (no client-side PDF parsing); a PDF has to come through
agent chat, where you read it natively and pass the extracted text.

## When the user shares a document for canvas import

If the user attaches a file (PDF, Word doc, text file) and asks to extract nodes, import it to the canvas, or build their messaging canvas from it — use the `canvas-import` skill.

Do NOT use this path for ICP documents (criteria files go to `add-persona-documents` / `create-icp-persona`). Use context clues: if the doc describes an account, company, prospect, or research, it's a canvas import. If it describes target customer criteria, messaging rules, or "who we sell to", it's an ICP doc.

## When asked about the Engagement tab

The Engagement tab shows LinkedIn post commenters loaded from the extension.
Each engager goes through a two-step enrichment:
1. `ingest-post-engager` — creates the row with basic info (name, company, comment).
2. `enrich-post-engager` — updates with full LinkedIn profile data, runs HubSpot
   owner lookup, and scores fit against the ICP. See the `post-engager-score` skill.

If asked to re-score an engager, call `enrich-post-engager` with the engager's id.
Do NOT draft connection notes for engagers from this tab — the user initiates
outreach separately via the normal LinkedIn profile flow.

## When asked about the Lead Lists tab

The Lead Lists tab shows Sales Navigator captures imported by the extension —
either a saved lead list, or a live filtered search on the Lead tab (most of
the team prospects this way instead of saving lists first). Either way the
xDR pages through it themselves (the extension never auto-clicks pagination —
this is deliberate, to avoid anything that looks like automated navigation),
and the extension accumulates each page's rows and imports the whole thing via
`import-sales-nav-list` when they click "Send to LinkedIn Agent" in the side
panel. A search capture gets a generated name like "Sales Nav Search — Aug 14,
9:04 AM" instead of a real list name, since a search results page has no name
to read off the page the way a saved list's tab title does.

The import itself is a shallow insert: `name`, `headline` (the job title
scraped from Sales Nav's list rows), `company`, `location`, and a
`salesNavLeadUrl` for each lead, with `profileUrl` left null. `import-sales-
nav-list` DOES assign a persona at import time (via `selectPersonasBatch` —
one batched LLM call classifying the whole list against active ICP personas,
not one call per lead), so `personaId`/`personaName`/`personaColor` get set
then.

**Every newly-imported lead is also opted into an automatic background
pipeline** (`autoEnrich: true`, enforced by `server/helpers/lead-pipeline-
sweep.ts`) that scores ICP fit, drafts a connection note, enriches (Apollo)
if the lead clears the fit bar, and promotes the lead into a real `prospects`
row — with no further action from the xDR and no dependency on the
browser/extension staying open. This is a deliberate policy change from the
old "on-demand only" rule: every imported lead is expected to be reached out
to, so there's no "decide later" step to gate on anymore. Concretely:

- The sweep runs as a debounced tick inside `server/middleware/lead-
  pipeline-sweep.ts`, triggered by the framework's own Netlify Scheduled
  Function that pings `/_agent-native/health` every 60s regardless of any
  visitor — li-agent has no cron primitive of its own, so this is the real
  trigger, not a metaphor. It only ever runs on that health-check request,
  never a real page load, so it can never slow down an xDR.
- **The order is SCORE-FIRST, deliberately**: prefilter (free) → score (LLM,
  zero Apollo credits) → gate on the verdict → reserve credits → enrich →
  promote. Do NOT reorder this back to enrich-then-score. Scoring is free and
  enrichment costs real money, so spending a credit before knowing whether
  the lead was worth it was the largest credit leak this app had. The stage
  machine lives on `leadListItems.pipelineStage`
  (`queued|scoring|scored|enriching|promoting|done|blocked|failed`), kept
  deliberately SEPARATE from `enrichmentStatus` — the latter still means only
  "the outcome of an Apollo lookup", which the audit-log export and every
  `EnrichedField` copy branch depend on.
- A lead that does not clear the fit bar is still scored, drafted and
  promoted. It is only never auto-*enriched*: the credit buys contact data,
  which the primary LinkedIn-connection motion doesn't need. It keeps its
  per-row Enrich button for explicit user action.
- The free prefilter matches the persona briefing's `avoidTitlesSearch`
  against the lead's headline. Do NOT add `titles` / `fallbackTitles` as a
  *positive* gate — Sales Nav headlines are freeform taglines, so a non-match
  is not evidence of a bad lead.
- **The sweep never reveals phone numbers.** `enrichApolloRecord` takes
  `{ revealPhone }` defaulting to `false`, and only `actions/reveal-phone.ts`
  ever passes `true`. See the Apollo credits section below.
- A lead stuck in `enriching` for over 2 minutes is retried, up to 3
  attempts, then marked `failed` (poison-lead guard). A budget refusal is NOT
  an attempt — it returns the lead to `queued` without incrementing
  `pipelineAttempts`, so a multi-day spend pause can't mark hundreds of leads
  permanently failed.
- An Apollo phone reveal stuck at `requested` for over 5 minutes is
  dispositioned `failed` — for `prospects` as well as `leadListItems`.
- **Scope**: only leads imported through this flow going forward have
  `autoEnrich: true`. Lists imported before this shipped are NOT
  retroactively swept — that would trigger a large, sudden Apollo-credit
  and LLM-call spike for leads nobody decided to act on. They still work
  exactly as before: on-demand "Enrich" + the manual "Score & Draft" button
  on the Prospects page.
- **Promotion requires a real profile URL.** `promoteLeadListItem` does NOT
  fall back to `salesNavLeadUrl` — a Sales Nav URL carries a member URN, not
  the public vanity slug, so a row keyed on it could never be reconciled with
  one `capture-profile.ts` later creates. Without a real `/in/…` URL the lead
  keeps its verdict and draft on `leadListItems` and gets no `prospects` row;
  `{ ok: false, code: "no_profile_url" }` is a normal expected outcome, not an
  error. This removes the old duplicate-`prospects`-row gap rather than
  building reconciliation around it. Consequence: `promotedProspectId` is set
  far less often, so the "In Prospects" chip fires rarely — the verdict badge
  replaced it as the primary signal. `actions/list-all-prospects.ts` returns
  the real `leadListItems` verdict/reason/note so this stays invisible to
  users.

There is deliberately no pending/visited/skipped status tracking on these rows
(removed — it added a filter/skip workflow that wasn't giving the xDR anything
useful). Rows just sit in the list; "Open LinkedIn" opens the link and nothing
else. Do not reintroduce a status field without being asked.

`import-sales-nav-list` dedupes against this owner's existing lead list items by
`salesNavLeadUrl` across ALL of their lists (not just the list being imported
into) — a lead already captured anywhere doesn't get inserted again, even on a
fresh import of the same or a different Sales Nav list. The response's
`duplicatesSkipped` count reflects how many were skipped this way.

Each row also has an on-demand "Enrich" action (`enrich-lead-list-item`, dashboard-
only, requires auth) that calls Apollo.io (`server/helpers/apollo-client.ts`) for
person match + company search, populating `enrichedEmail`, `enrichedTitle`,
`enrichedLinkedinUrl`, `enrichedCompanyIndustry`, `enrichedCompanySize` on that
item. This is separate from and does not affect ICP scoring — it's a data lookup,
not a fit judgment. This is still the right action to reach for when manually
re-enriching a pre-existing (non-`autoEnrich`) row or a single row on demand;
only bulk/automatic triggering at import time changed.

## Apollo enrichment

Both the Prospects table (`/`) and the Lead Lists table (`/lead-lists`) have a
per-row "Enrich" button that calls Apollo.io on demand: `enrich-prospect` for
prospects, `enrich-lead-list-item` for lead list items. Both go through the one
shared helper `server/helpers/enrich-apollo-record.ts` (do NOT reintroduce a
per-table copy — the duplication it replaced is how the 8-credit sweep reveal
leak got in) onto `server/helpers/apollo-client.ts` and the same enrichment
columns (`enrichmentStatus`, `enrichedEmail`, `enrichedTitle`, `enrichedPhone`,
`enrichedLinkedinUrl`, `enrichedCompanyIndustry`, `enrichedCompanySize`,
`enrichedAt`, `enrichmentError`). This is a data lookup, not an ICP fit
judgment, and must not influence scoring or draft notes.

- **Every Apollo call costs real money and is governed.** See the credit
  governance section below; nothing may call Apollo without an authorization
  from the guard.
- Automatic enrichment happens for `autoEnrich` leads that clear the fit bar
  (see the Lead Lists section). Everything else is user-triggered: one row, or
  a capped bulk run. Never call it at capture/import time.
- Email/Phone columns distinguish "never enriched" (—) from "enriched but
  Apollo had no email/phone" (done, field empty) from "no match at all"
  (not_found) from a real API error (failed, with the message in
  `enrichmentError` / the Retry button's tooltip) — don't collapse these back
  into one generic blank state.
- `cleanForApolloMatch()` in `apollo-client.ts` strips emoji from names/company
  names before sending them to Apollo (LinkedIn-captured names/titles/companies
  sometimes carry emoji that hurt Apollo's fuzzy matching). Keep this centralized
  there rather than re-implementing per caller.
- A phone number arrives one of two ways: Apollo's synchronous
  `person.contact.phone_numbers` (free, only populated when Apollo has already
  revealed that person for this team), or the paid async
  `reveal_phone_number` + webhook flow, which this app now implements and
  charges for. See below.

## Apollo credit governance

Apollo bills **1 credit** for a person match (email) and **8** for a phone
reveal. This workspace is **one of three tools** on an 83,990-credit-per-period
account, so this app budgets its own ~1/3 share (~27,996) rather than Apollo's
real balance — we cannot see what the other two spend.

Everything lives under `server/helpers/apollo-credits/`:

- `period.ts` — the billing window is a **pure function of the clock**
  (`billingPeriodContaining(anchorDay)`), anchored to a day-of-month clamped to
  1–28 and computed in UTC. There is **no reset job and no counter to corrupt**:
  spend is `WHERE periodStart = <computed>`. This deployment has no reliable
  cron, so anything requiring a scheduled reset would eventually be wrong.
- `settings.ts` — every `apollo_*` key in `workspace_settings`, read in one
  `key LIKE 'apollo_%'` query. **Unset means DISABLED.** A missing or corrupted
  row must never be the thing that re-enables spending. Deliberately uncached
  so the kill switch takes effect instantly.
- `ledger.ts` — `apollo_credit_ledger`, append-only, one row per credit-bearing
  unit with `periodStart` denormalized and the `fitVerdict` **at spend time**,
  which is what makes "how many credits went to weak leads" answerable. This is
  the "what did we pay" record; `list-enrichment-audit-log` remains the "who has
  data" report and cannot answer cost questions (it derives from current row
  state, so a re-enrich is invisible to it).
- `guard.ts` — the single choke point. `CreditAuthorization` is a **branded
  type that cannot be constructed outside this file**, and `apolloFetch`
  requires one, so bypassing the budget is a **compile error rather than a
  convention**. Do not weaken that.

**Every credit decision fails CLOSED**, deliberately the opposite of
`isOverDailyLimit`'s fail-open behaviour: if the settings or ledger can't be
read, the spend is denied. A database outage must not become an unmetered
spending window. The downside here is money, not a blocked capture.

Tiered degradation, applied inside the guard so no call site reimplements it:
phone reveals stop at **80%** of budget while emails keep working; all
enrichment stops at **100%**. The background sweep may consume at most **50%**
of the period, reserving the rest for work people do by hand. Each user also
has their own ceiling (default 2,000/period, overridable per user in Settings →
Per-User Credit Limits), so one person's bulk run can't drain the pool.

- **Phone reveals are a separate, explicit action** (`actions/reveal-phone.ts`),
  never a side effect of enrichment. Its schema requires `confirmCredits: 8`, so
  a stale client or blind retry structurally cannot spend by accident. The fit
  gate is overridable with a deliberate two-step confirmation; the 80% pause is
  **not** overridable, because it is a policy rather than a nag.
- **There is no bulk reveal, deliberately.** At 8 credits, 50 leads is 400
  credits from one click and no confirmation design makes that genuinely
  deliberate.
- Bulk enrichment is capped at `MAX_BULK_ENRICH = 50` per run
  (`app/lib/apollo-limits.ts`), and a truncated batch is always sorted
  stellar-first so the cap steers rather than just limits.
- A budget refusal **halts** a bulk loop (`BULK_HALT_CODES`) and reports partial
  progress in a persistent banner. Do not restore the old catch-and-continue:
  it failed silently 50 times and told the user nothing.
- The reveal webhook (`actions/apollo-phone-reveal-webhook.ts`) is idempotent
  (keyed on a payload hash) and reconciles Apollo's reported
  `credits_consumed`, clamped — a forged large value can't rewrite the ledger.
- Threshold notifications are **in-app only** (`channels: ["inbox"]`). That is
  mandatory, not a default: core always registers the webhook/Slack/email
  channels and they activate off `NOTIFICATIONS_*` env vars, so omitting it
  would silently fan credit warnings out to Slack the moment one is set.

Several Apollo billing behaviours **cannot be verified from code** (whether a
no-match still bills, whether a combined match+reveal is 9 or 8, whether
org-enrich bills at all, Apollo's reset timezone). Each is recorded in the
ledger so it stays correctable rather than baked in. **Run a low-budget pilot
before trusting the real number**: set the budget to ~200, enrich ~20 leads,
then compare the ledger against Apollo's real balance.

## Prospect tags

Replaced the old fixed captured/drafted/sent Status column on the Prospects
table (`/`) with user-created tags — named, colored labels the user defines
themselves, shown as chips in a "Tags" column and filterable via pills in the
toolbar (same style as the Persona filter). The underlying `status` lifecycle
on `prospects` (captured → drafted → sent) still exists and still drives
real logic (the "Drafting…" placeholder, gating "Mark sent", the daily-limit
count) — only its dedicated UI column and filter were removed.

- Schema: `prospectTags` (id, ownerEmail, name, color) and `prospectTagLinks`
  (many-to-many join: prospectId, tagId).
- Actions: `list-prospect-tags` (with per-tag prospect counts),
  `create-prospect-tag`, `update-prospect-tag` (rename/recolor),
  `delete-prospect-tag` (cascades its links), `set-prospect-tags` (replaces
  one prospect's full tag set), `bulk-tag-prospects` (adds one tag to many
  prospects at once, e.g. from a multi-select).
- Tags are prospects-only, same scope as rating/note/mark-sent (see the Lead
  Lists section above) — a lead list item has to be promoted into a real
  `prospects` row before it can be tagged. `list-all-prospects.ts` always
  returns `tags: []` for lead_list-sourced rows.
- Tag management (create/rename/recolor/delete) lives inside the same
  `TagManagerPopover` component used for per-row assignment (in
  `app/routes/_index.tsx`) — reachable either from a prospect's own tag
  picker or from the "Manage tags" button in the page header. Don't build a
  separate tags settings page; extend that one component instead.

## Hard rules
- Never fabricate facts about a prospect. Personalize only from
  what the capture actually contains. If a field is missing, work
  with what is there.
- One note plus at most one short follow-up. No bulk sequences.
- Don't decide mid-chat to call HubSpot, Apollo, or any sending service on
  your own initiative. HubSpot lookups the app itself performs (owner
  checks, warm-context, the HubSpot Reference node) are existing, reviewed
  product behavior, not something to add ad hoc.
- Never use em dashes in any AI-generated messaging this app produces
  (connection notes, follow-ups, canvas previews). Enforced in
  `server/helpers/style-rules.ts` (`NO_EM_DASH_RULE` prompt instruction +
  `stripEmDashes()` output sanitizer) — reuse both when adding a new
  message-generating prompt rather than duplicating the rule inline.

## Key files
- docs/BUILD-GUIDE.md: build steps
- docs/DECISIONS.md: settled decisions and why-nots
- server/db/schema.ts: prospects, send_history, icpSources (legacy singleton
  fallback); icpPersonas/icpPersonaDocs are legacy/frozen (see above)
- packages/shared/src/server/persona-docs.ts: getPersonaCriteriaText /
  rebuildPersonaCriteriaText — computes a shared persona's criteria text
  from its documents; the only thing that should write sharedPersonas.summary
- server/helpers/apollo-credits/: credit governance (guard, ledger, period,
  settings, per-user limits, threshold notifications). `guard.ts` is the only
  thing that may authorize an Apollo call.
- server/helpers/enrich-apollo-record.ts: the ONE enrichment path for both
  prospects and lead list items
- server/helpers/lead-pipeline-sweep.ts: the score-first background pipeline
- app/lib/lead-quality.ts: the stellar/good/ok/low/unscored ranking used for
  badges, sorting and batch truncation
- app/lib/apollo-limits.ts: batch cap, halt codes, credit costs (client side)
