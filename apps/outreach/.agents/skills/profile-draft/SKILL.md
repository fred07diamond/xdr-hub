---
name: profile-draft
description: Use when a LinkedIn profile has been captured by the Builder.LI extension and needs a fit score and a drafted connection note. Covers reading the captured fields, loading the selected Notion ICP docs live, scoring fit, and drafting a personalized note.
---

# Profile draft workflow

Runs when the extension sends a captured profile to the
capture-profile action. Produce a fit verdict and one drafted
connection note. Never send anything; the user sends by hand.

## Step 1: Read the capture
Fields available: name, headline, current role, company, about
text, recent activity/posts, and the profile URL. Some may be
empty depending on what the page exposed.

## Step 2: Load the active ICP context (live from Notion)
Call get-icp-sources to get the currently selected Notion page
IDs. For each, call mcp__notion__fetch to read the page, then
combine them into one ICP context (ideal titles, company
attributes, disqualifiers, voice/tone).

If get-icp-sources returns nothing, or a Notion fetch fails,
proceed using the profile alone and clearly mark the result
"no ICP loaded" so the user knows the draft was not scored
against their ICP. Do not invent an ICP.

## Step 3: Score fit
Compare the profile against the combined ICP context. Return a
short verdict (strong / possible / weak) with one line of
reasoning. If the person is a clear disqualifier per the ICP
docs, say so plainly so the user can skip them.

## Step 4: Draft the note
Write one connection note that:
- References something specific and true from the capture (a post,
  a role detail, shared context). Never invent facts.
- Matches the voice defined in the ICP docs.
- Fits LinkedIn's limit: 300 chars Premium/Sales Navigator, about
  200 free. Validate length before returning.
- Holds the pitch. The note earns the accept; the ask comes later.

Optionally draft a short follow-up for after they accept.

## Step 5: Store and return
Write the verdict, reasoning, note, and follow-up to the
prospect's row and set status "drafted" so the extension can
display them. Record the profile in send_history only when the
user marks it sent (via mark-sent), not at draft time.

## Do / Don't
- DON'T fabricate anything about the prospect or the ICP.
- DON'T design or suggest auto-send or browser automation.
- DON'T draft more than one note plus one optional follow-up.
- DO draft against the current Notion selection, read fresh each
  time, so updated docs are always reflected.
