---
name: profile-draft
description: Use when a LinkedIn profile has been captured by the Builder.LI extension and needs a fit score and a drafted connection note. Covers reading the captured fields, checking HubSpot warm context, loading the selected Notion ICP docs live, scoring fit, and drafting a personalized note.
---

# Profile draft workflow

Runs when the extension sends a captured profile to the
capture-profile action. Produce a fit verdict and one drafted
connection note. Never send anything; the user sends by hand.

## Step 1: Read the capture
Fields available: name, headline, current role, company, about
text, recent activity/posts, and the profile URL. Some may be
empty depending on what the page exposed.

## Step 1.5: Check HubSpot warm context (best-effort)
Call check-hubspot-contact with the profile URL. If the call fails
or returns found=false, skip this step and continue with the cold
path in Step 4.

If found=true, note these warm-outreach signals for Step 4:
- ownerName: the AE or rep already working this contact
- formMessage: their own words about their problem or company,
  captured from a form submission
- firstPageSeen / lastPageSeen: which pages they visited on the
  Builder.io site — signals what they were researching
- isInSequence: they are currently in an active email sequence

These signals mean this is a warm account. LinkedIn should be
a personal, supplemental touchpoint — not a cold intro.

## Step 2: Load the active ICP context
Call get-icp-sources. Check the `icpText` field first — it holds
a directly uploaded ICP document and takes priority.

If icpText is null or empty AND sources is empty:
- Set verdict = "inconclusive"
- Set fit_reason = "No ICP document uploaded — go to the ICP
  tab and upload your ICP criteria to enable fit scoring."
- Do not guess or invent ICP criteria. Do not return "strong",
  "possible", or "weak" without a real ICP.
- Continue to Step 4 and draft a generic note from the profile
  alone (no ICP voice or targeting — just a polite, professional
  intro based on what the profile shows).

If icpText has content, use it as the ICP.
If icpText is null but sources has Notion page IDs, call
mcp__notion__fetch for each and combine into ICP context.
If a Notion fetch fails, fall back to icpText if available,
otherwise use the no-ICP path above.

## Step 3: Score fit
Compare the profile against the combined ICP context. Return a
short verdict (strong / possible / weak) with one line of
reasoning. If the person is a clear disqualifier per the ICP
docs, say so plainly so the user can skip them.

## Step 4: Draft the note

**If HubSpot data is present (warm path):**
LinkedIn is a warm, personal channel — the goal is to close
the loop on existing outreach, not pitch from scratch.

The note should feel like a thoughtful human checking in, not
a sequence step. LinkedIn is more reflective and personal than
email; match that tone.

- If isInSequence=true: acknowledge the existing conversation.
  The note can reference "our team's outreach" or name the owner
  if that feels natural (e.g. "I saw [ownerName] has been in touch
  — wanted to reach out personally as well"). Keep it light; don't
  repeat what the email sequence has already said.
- If formMessage is present: they expressed their own problem in
  their own words. Reference the topic or pain they described
  without quoting verbatim or saying "you filled out a form".
  Example: if they mentioned 10 Shopify stores, note their
  multi-store commerce context; if they mentioned a specific
  challenge, reference that pain point naturally.
- If firstPageSeen or lastPageSeen reference a specific topic
  (e.g. headless CMS, composable commerce, edge delivery),
  weave that intent signal in naturally — it shows you know what
  they were researching without being creepy about it.
- Never start with "I noticed you…" or similar surveillance clichés.
- Never fabricate. Only reference signals actually present in the
  HubSpot data or the LinkedIn capture.

**If no HubSpot data (cold path):**
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
- DO use HubSpot warm context when available — treat LinkedIn as a
  personal, supplemental channel that closes the loop on emails,
  sequences, or meetings, not a cold outreach channel.
