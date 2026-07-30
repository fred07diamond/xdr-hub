---
name: post-engager-score
description: Reference for how Builder.LI actually scores and drafts for a LinkedIn post commenter. This runs synchronously in code via enrich-post-engager.ts, not as an agent-orchestrated skill — read this to understand or extend that code path, not to execute it as a chat workflow.
---

# How post-engager enrichment actually works

Runs synchronously inside `actions/enrich-post-engager.ts` when the extension
sends full profile data for a commenter that `ingest-post-engager.ts` already
created a bare row for. No agent turn is involved in a normal enrichment.

## The real flow (`actions/enrich-post-engager.ts`)

1. Save the enriched profile fields onto the `post_engagements` row, status
   `enriching`.
2. HubSpot lookup — a direct contact search (same filter strategy as
   `check-hubspot-contact.ts`, but implemented inline here, not by calling
   that action). Owner resolution order: `xdr_owner` custom field first,
   then the contact's HubSpot owner, then the associated company's owner as
   a last resort. No match → `hubspotStatus = "new_opportunity"`.
3. `selectPersona()` (`server/helpers/select-persona.ts`) — the same
   persona-matching logic `capture-profile.ts` uses: single persona with a
   doc wins outright, multiple personas get an AI classification pick, none
   falls back to the legacy single ICP document.
4. `scoreEngager()` (`server/helpers/score-engager.ts`) — one `completeText()`
   call. The comment text is passed as extra evidence: a substantive,
   on-topic comment counts for more than a generic profile.
5. Draft a connection note (same drafting call path as a normal capture) and
   write everything back, status `drafted`.

## Scoring rubric currently in `score-engager.ts`

- **strong**: title/seniority matches the ICP, OR the comment itself shows
  clear relevant intent/interest.
- **possible**: adjacent title or seniority, no behavioral signal.
- **weak**: clear mismatch.
- **inconclusive**: no ICP document uploaded — never guessed.

## Hard rules (still true, still enforced in the prompt)

- Never fabricate anything about the engager. Score and draft only from
  what the capture and comment actually contain.
- Draft note under ~280 characters, referencing something specific and real.
- Nothing sends automatically.

If you're extending this, the place to do it is `score-engager.ts`'s
`systemPrompt` (or the shared drafting helper), not this doc — keep this file
in sync with whatever the code actually does after that change.
