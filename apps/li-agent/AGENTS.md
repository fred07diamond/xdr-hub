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
If the user pastes text or attaches one or more files (.txt, .md,
or PDF) containing their ICP criteria:
1. Extract all the text content. If multiple files are attached,
   concatenate them in order with a blank line between each.
2. Call save-icp-document with the combined full text.
3. Confirm what was saved: echo a short summary of the key
   criteria you found (target role, company size, signals, etc.)
   so the user can verify it was read correctly.

## When the user shares a document for canvas import

If the user attaches a file (PDF, Word doc, text file) and asks to extract nodes, import it to the canvas, or build their messaging canvas from it — use the `canvas-import` skill.

Do NOT use this path for ICP documents (criteria files go to `save-icp-document`). Use context clues: if the doc describes an account, company, prospect, or research, it's a canvas import. If it describes target customer criteria, messaging rules, or "who we sell to", it's an ICP doc.

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

The Lead Lists tab shows Sales Navigator saved lead lists imported by the extension.
The xDR opens a saved list in Sales Navigator, pages through it themselves (the
extension never auto-clicks pagination — this is deliberate, to avoid anything
that looks like automated navigation), and the extension accumulates each page's
rows and imports the whole list via `import-sales-nav-list` when they click
"Send to LinkedIn Agent" in the side panel.

This is a shallow import: `name`, `headline` (the job title scraped from Sales
Nav's list rows), `company`, `location`, and a `salesNavLeadUrl` for each lead,
with `profileUrl` left null. `import-sales-nav-list` DOES assign a persona at
import time (via `selectPersonasBatch` — one batched LLM call classifying the
whole list against active ICP personas, not one call per lead), so
`personaId`/`personaName`/`personaColor` get set then. This is persona
classification only, not full ICP fit scoring: it does NOT set a fit
verdict/reasoning or draft a connection note as part of the import — those still
happen later, one lead at a time, through the normal `capture-profile` flow when
the xDR actually opens that lead's profile page, at which point `profileUrl` also
gets resolved. Treat a Lead Lists row as a "to visit" queue item, not as a
captured prospect ready for outreach.

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
not a fit judgment. Never trigger it automatically at import time or in bulk
without being asked; it spends Apollo credits per call.

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

## Hard rules
- Never fabricate facts about a prospect. Personalize only from
  what the capture actually contains. If a field is missing, work
  with what is there.
- One note plus at most one short follow-up. No bulk sequences.
- Don't decide mid-chat to call HubSpot, Apollo, or any sending service on
  your own initiative. HubSpot lookups the app itself performs (owner
  checks, warm-context, the HubSpot Reference node) are existing, reviewed
  product behavior, not something to add ad hoc.

## Key files
- docs/BUILD-GUIDE.md: build steps
- docs/DECISIONS.md: settled decisions and why-nots
- server/db/schema.ts: prospects, send_history, icpSources (icpText column)
