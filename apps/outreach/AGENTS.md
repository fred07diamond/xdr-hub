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

## Hard rules
- Never fabricate facts about a prospect. Personalize only from
  what the capture actually contains. If a field is missing, work
  with what is there.
- One note plus at most one short follow-up. No bulk sequences.
- Do not call HubSpot, Apollo, or any sending service.

## Key files
- docs/BUILD-GUIDE.md: build steps
- docs/DECISIONS.md: settled decisions and why-nots
- server/db/schema.ts: prospects, send_history, icpSources (icpText column)
