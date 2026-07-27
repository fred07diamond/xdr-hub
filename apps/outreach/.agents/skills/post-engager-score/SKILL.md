---
name: post-engager-score
description: Use when a LinkedIn post commenter has been loaded into the Engagement tab and needs a HubSpot owner lookup and ICP fit verdict. No connection note is drafted — verdict only.
---

# Post engager scoring workflow

Runs after the extension loads a commenter from a LinkedIn post. Produce
a fit verdict only. No connection note is needed here — the user decides
whether to outreach via the normal Profile tab flow.

## What is available
Fields from the engager record: engager_name, engager_company,
engager_headline, engager_role, engager_about, engager_recent_activity,
comment_text, post_url. Some may be null if enrichment hasn't run yet.

## Step 1: Check HubSpot owner
Call check-hubspot-contact with the engager's profile URL or name/company.
Record xdr_owner (XDR Owner custom field) and ownerName (contact owner
as fallback). If HubSpot returns found=false, hubspot_status = "new_opportunity".

## Step 2: Load ICP context
Call get-icp-sources. Use icpText field as the ICP document.
If icpText is null or empty, return verdict = "inconclusive" with the
standard "No ICP document uploaded" reason.

## Step 3: Score fit
Compare the engager's profile fields against the ICP. Weight the comment
text as an extra engagement signal — a substantive comment about the topic
is stronger evidence than years of experience. Return:
- strong: title/seniority match OR clear comment engagement signal
- possible: adjacent title/seniority, no behavioral signals
- weak: clear mismatch
- inconclusive: no ICP uploaded

## Hard rules
- Do NOT draft a connection note. Verdict only.
- Never fabricate facts. Score only what the capture contains.
- Write fit_reason in one sentence citing the strongest specific evidence.
