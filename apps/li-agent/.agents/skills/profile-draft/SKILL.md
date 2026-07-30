---
name: profile-draft
description: Reference for how Builder.LI actually scores and drafts a captured LinkedIn profile. This runs synchronously in code, not as an agent-orchestrated skill — read this to understand or extend that code path, not to execute it as a chat workflow.
---

# How profile capture, scoring, and drafting actually work

This used to describe an agent-driven, multi-step chat workflow. It doesn't
work that way today: `capture-profile.ts` runs the whole thing synchronously,
in code, in a single action call. There is no agent turn in the loop for a
normal capture. This doc now describes the real code path so it stays useful
as a reference instead of describing behavior that no longer exists.

## The real flow (`actions/capture-profile.ts`)

1. Upsert the `prospects` row from the captured fields (name, headline, role,
   company, about, recent activity), status `captured`.
2. Call `selectPersona()` (`server/helpers/select-persona.ts`):
   - If exactly one ICP persona has an uploaded document, use it directly.
   - If multiple personas have documents, a small `completeText()` call
     classifies the profile against short persona summaries and picks the
     best match.
   - If none have a document, fall back to the older single "ICP document"
     (`icp_sources` table, pre-dates personas).
   - If nothing is available at all, `icpText` is null.
3. Build messaging context: `buildCanvasContext()` if a `canvasId` was given
   (and passes ownership checks), otherwise `buildMessagingContext()` walks
   the persona's node tree on the Messaging Canvas.
4. Call `draftProfile()` (`server/helpers/draft-profile.ts`) — one
   `completeText()` call that scores fit and drafts the note together. No
   ICP → verdict is forced to `"inconclusive"` with a fixed reason; the
   model never invents a score. Untrusted profile text is passed as the
   `input`, never concatenated into the `systemPrompt`.
5. Write `fitVerdict`, `fitReason`, `draftNote`, `draftFollowUp` back to the
   prospect row, status `drafted`.

## HubSpot warm context

Not part of `capture-profile.ts`'s own flow. `check-hubspot-contact.ts` is a
separate action the extension calls itself to show a "already in HubSpot"
badge — it does not feed into the draft prompt. If you want warm-context
(sequence status, past form messages) to actually shape the drafted note,
that's a real gap to close in `draft-profile.ts`, not something already
wired up.

## Scoring rubric currently in `draft-profile.ts`

- **strong**: title/seniority matches the ICP, or a specific behavioral
  signal in recent activity (engaging with a relevant tool/vendor/theme).
- **possible**: genuine uncertainty only — adjacent title or one seniority
  level off, with no behavioral signal either way.
- **weak**: clear mismatch, explicit counter-evidence, or too junior.
- **inconclusive**: no ICP document available — never guessed.

## Hard rules (still true, still enforced in the prompt)

- Never fabricate anything about the prospect. Only reference what the
  capture, HubSpot data (when actually wired in), or ICP docs contain.
- Draft note max ~200 characters plus an optional short follow-up.
- Nothing sends automatically — the human always sends by hand.

If you're extending this (e.g. wiring HubSpot warm context into drafting, or
adding style rules like banned phrases), the place to do it is
`draft-profile.ts`'s `systemPrompt`, not this doc — keep this file in sync
with whatever the code actually does after that change.
