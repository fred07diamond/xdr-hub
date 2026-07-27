---
name: post-engager-score
description: Use when a LinkedIn post commenter has been loaded into the Engagement tab and needs a HubSpot owner lookup, ICP fit verdict, persona assignment, and a drafted connection note.
---

# Post engager scoring workflow

Runs after the extension loads a commenter from a LinkedIn post. Produces
a fit verdict, persona assignment, and a drafted connection note.

## What is available
Fields from the engager record: engager_name, engager_company,
engager_headline, engager_role, engager_about, engager_recent_activity,
comment_text, post_url. Some may be null if enrichment hasn't run yet.

## Step 1: Check HubSpot owner
Call check-hubspot-contact with the engager's profile URL or name/company.
Record xdr_owner (XDR Owner custom field) as primary owner.
Fall back to contact owner, then company owner.
If HubSpot returns found=false, hubspot_status = "new_opportunity".

## Step 2: Load ICP context
Call get-icp-sources. Use icpText field as the ICP document.
If icpText is null or empty, return verdict = "inconclusive" with the
standard "No ICP document uploaded" reason.

## Step 3: Assign persona
Match the engager's profile against available ICP personas to select the
best-fitting one. Record persona_id, persona_name, persona_color.

## Step 4: Score fit
Compare the engager's profile fields against the ICP. Weight the comment
text as an extra engagement signal — a substantive comment about the topic
is stronger evidence than years of experience. Return:
- strong: title/seniority match OR clear comment engagement signal
- possible: adjacent title/seniority, no behavioral signals
- weak: clear mismatch
- inconclusive: no ICP uploaded

## Step 5: Draft connection note
Draft a personalized LinkedIn connection note (under 280 characters)
regardless of fit verdict. Reference something specific and real about the
engager's work or their comment. Never fabricate facts.

## Hard rules
- Never fabricate facts. Score and draft only from what the capture contains.
- Write fit_reason in one sentence citing the strongest specific evidence.
