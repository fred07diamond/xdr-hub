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

A persona holds MANY ICP documents, not one. `icpPersonas.icpText` is a
DERIVED column: `server/helpers/persona-docs.ts` rebuilds it by
concatenating every row in `icpPersonaDocs` for that persona (each one
prefixed with its filename as a `## ` heading, separated by `---`), which
is why `selectPersona`, `selectPersonasBatch`, `draft-profile`,
`score-engager`, `generate-sales-nav-search`, and `get-messaging-graph`
all still read a single `icpText` field. **Never write
`icpPersonas.icpText` directly** — call `rebuildPersonaIcpText()` or the
column and the docs table drift apart.

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
sweep.ts`) that enriches (Apollo), scores ICP fit, drafts a connection note,
and promotes the lead into a real `prospects` row — with no further action
from the xDR and no dependency on the browser/extension staying open. This
is a deliberate policy change from the old "on-demand only" rule: every
imported lead is expected to be reached out to, so there's no "decide
later" step to gate on anymore. Concretely:

- The sweep runs as a debounced tick inside `server/middleware/lead-
  pipeline-sweep.ts`, triggered by the framework's own Netlify Scheduled
  Function that pings `/_agent-native/health` every 60s regardless of any
  visitor — li-agent has no cron primitive of its own, so this is the real
  trigger, not a metaphor. It only ever runs on that health-check request,
  never a real page load, so it can never slow down an xDR.
- A lead moves `enrichmentStatus: idle → enriching → done/not_found/failed`
  (reusing `server/helpers/enrich-lead-list-item.ts`), then immediately
  gets scored + drafted + upserted into `prospects` via `server/helpers/
  score-lead-list-item.ts` (status: `drafted`), and `promotedProspectId`
  gets set once that lands — shown in the Lead Lists UI as an "In
  Prospects" badge.
- A lead stuck in `enriching` for over 2 minutes is retried, up to 3
  attempts, then marked `failed` (poison-lead guard).
- An Apollo phone reveal stuck at `requested` for over 5 minutes is
  dispositioned `failed` — same threshold `lead-lists.tsx`'s
  `PHONE_REVEAL_STALE_AFTER_MS` already used for display, now persisted for
  real so it shows correctly in Analytics' Phone Reveal "Failed" bucket
  instead of silently vanishing.
- **Scope**: only leads imported through this flow going forward have
  `autoEnrich: true`. Lists imported before this shipped are NOT
  retroactively swept — that would trigger a large, sudden Apollo-credit
  and LLM-call spike for leads nobody decided to act on. They still work
  exactly as before: on-demand "Enrich" + the manual "Score & Draft" button
  on the Prospects page.
- **Known gap**: a lead promoted via the `salesNavLeadUrl` fallback (Apollo
  didn't resolve a real `linkedin.com/in/...` URL) can end up as a second,
  separate `prospects` row if the xDR later visits the real profile page
  through `capture-profile.ts` — the two rows are keyed by different
  `profileUrl` values and don't get reconciled.

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
prospects, `enrich-lead-list-item` for lead list items. Both share the same
`server/helpers/apollo-client.ts` (person match + company search) and the same
enrichment columns (`enrichmentStatus`, `enrichedEmail`, `enrichedTitle`,
`enrichedPhone`, `enrichedLinkedinUrl`, `enrichedCompanyIndustry`,
`enrichedCompanySize`, `enrichedAt`, `enrichmentError`). This is a data lookup,
not an ICP fit judgment, and must not influence scoring or draft notes.

- On-demand only — the user always triggers it (one row, "Enrich selected" on
  Prospects, or "Enrich all" on a Lead List). Never call it automatically at
  capture/import time.
- Email/Phone columns distinguish "never enriched" (—) from "enriched but
  Apollo had no email/phone" (done, field empty) from "no match at all"
  (not_found) from a real API error (failed, with the message in
  `enrichmentError` / the Retry button's tooltip) — don't collapse these back
  into one generic blank state.
- `cleanForApolloMatch()` in `apollo-client.ts` strips emoji from names/company
  names before sending them to Apollo (LinkedIn-captured names/titles/companies
  sometimes carry emoji that hurt Apollo's fuzzy matching). Keep this centralized
  there rather than re-implementing per caller.
- Phone numbers come from Apollo's synchronous `person.contact.phone_numbers`
  field — only populated when Apollo has already "revealed" that person for
  this team. A brand-new person Apollo has never seen will show no phone; this
  does not implement Apollo's separate paid async reveal_phone_number+webhook
  flow.

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
- server/db/schema.ts: prospects, send_history, icpPersonas +
  icpPersonaDocs (many docs per persona; icpText is derived), icpSources
  (legacy singleton fallback)
- server/helpers/persona-docs.ts: rebuilds a persona's icpText from its
  documents; the only thing that should write that column
