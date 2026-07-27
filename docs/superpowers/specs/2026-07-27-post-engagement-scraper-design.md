# Post Engagement Scraper — Design Spec

**Date:** 2026-07-27
**Status:** Approved

## Overview

Add a "Post Engagement" feature to Builder.LI. When a user navigates to a LinkedIn post by Builder.io or Steve Sewell, a new Engagers tab in the Chrome extension side panel lists all visible commenters. The user multi-selects who to load; selected engagers are sent to the outreach app, enriched via background LinkedIn profile scraping, cross-referenced against HubSpot (XDR Owner), scored by the agent against the active ICP, and surfaced in a new Engagement tab that replaces the Chat tab.

## User Flow

1. User navigates to a LinkedIn post in Chrome.
2. Extension side panel auto-switches to the **Engagers tab**.
3. Panel lists all visible commenters: checkbox, name, company, comment preview.
4. User checks specific people (or uses Select All) and clicks **"Load Selected (N)"**.
5. Selected engagers appear immediately in the app's Engagement tab with status `pending`.
6. Extension service worker opens each selected person's LinkedIn profile in a silent background tab, scrapes the full profile, sends enriched data to the app, closes the tab. Status advances to `enriching` then `scoring`.
7. Agent reads enriched profile + ICP + HubSpot and writes fit verdict + HubSpot owner. Status becomes `done`.
8. Engagement tab shows the final list: name, company, XDR owner, HubSpot status badge, fit verdict badge, fit reason.

## Section 1 — Extension: Engagers Tab

### Tab switcher
- Side panel (`panel.html` / `panel.js`) gains a two-tab UI: **Profile** | **Engagers**.
- On profile pages (`/in/*`): defaults to Profile tab (existing behavior unchanged).
- On post pages (`/posts/*`, `/feed/update/*`): defaults to Engagers tab.
- User can switch tabs manually at any time.

### Engagers tab UI
- **Select All / Deselect All** toggle at the top.
- List of visible commenters, each row: checkbox + name + company (from headline) + comment preview.
- **"Load Selected (N)"** button at the bottom, enabled only when ≥1 checkbox is checked. N reflects the current selection count.
- Each row shows a status chip after loading: `Enriching…` → `Done`.

### Post page detection
- `content.js` extended with a `scrapeCommenters()` function for post page URLs.
- Runs on `document_idle` on `/posts/*` and `/feed/update/*` (new `content_scripts` entry in `manifest.json`).
- Scrapes each commenter: name, company/headline, profile URL, comment text, post URL, and first ~80 chars of the post text as `post_title`.
- Sends results to the panel via `chrome.runtime.sendMessage`.

### Background enrichment
- When user clicks "Load Selected", `panel.js` messages `background.js` with the array of selected engagers.
- `background.js` POSTs basic info for all selected engagers to `ingest-post-engager` immediately.
- Then processes each profile URL sequentially (not in parallel, to avoid LinkedIn rate-limiting):
  1. `chrome.tabs.create({ url: profileUrl, active: false })` — background tab, not visible.
  2. Waits for `chrome.tabs.onUpdated` status `complete`.
  3. `chrome.scripting.executeScript` injects the profile scraper logic.
  4. Sends enriched data to `enrich-post-engager`.
  5. `chrome.tabs.remove(tabId)` closes the tab.
- Panel polls `get-post-engager` per engager to reflect status updates.

## Section 2 — App: Engagement Tab

### Navigation
- Chat tab removed; **Engagement** tab added in its place.

### Layout
- **Posts sidebar** (left): lists every scraped post (title + engager count). Clicking filters the main list to that post. "All Posts" shows everyone.
- **Engager table** (main): columns — Name/Company (linked to LinkedIn profile), Comment preview, HubSpot status, Fit verdict, Status indicator.

### HubSpot status badge
- `found`: shows XDR owner name (or contact owner as fallback) in a neutral badge.
- `new_opportunity`: highlighted badge (e.g. amber) to signal a net-new account.

### Fit verdict badge
- `strong` / `possible` / `weak` / `inconclusive` — same palette as existing prospect cards.
- Fit reason shown as a subtitle line beneath the verdict.

### Status indicator per row
- `Pending` → `Enriching` → `Scoring` → `Done` — updates in real time via SSE/polling (existing real-time sync pattern).

### No auto-drafting
- Fit verdict is the output of this flow. Connection note drafting is intentionally deferred — if the user wants to outreach someone, they navigate to that person's LinkedIn profile and the existing Profile tab flow runs.

## Section 3 — Data Model

New table: **`post_engagements`**

```
id                  text, primary key
owner_email         text
post_url            text (the LinkedIn post URL)
post_title          text (first ~80 chars of post text)
engager_name        text
engager_company     text
engager_profile_url text
comment_text        text
xdr_owner           text (null if not in HubSpot)
contact_owner       text (HubSpot contact owner fallback)
hubspot_status      text  enum: found | new_opportunity
fit_verdict         text  enum: strong | possible | weak | inconclusive
fit_reason          text
status              text  enum: pending | enriching | scoring | done
created_at          text
updated_at          text
```

No changes to the existing `prospects` table. Post engagements are a discovery pool, not outreach records.

## Section 4 — Actions

| Action | Method | Auth | Purpose |
|---|---|---|---|
| `ingest-post-engager` | POST | `publicAgent: { expose: true }` | Creates `post_engagements` row with basic info. Sets status `pending`. |
| `enrich-post-engager` | POST | `publicAgent: { expose: true }` | Updates row with full LinkedIn profile fields. Sets status `enriching`, triggers agent scoring. |
| `list-post-engagements` | GET | `readOnly` | Returns all engagements, optionally filtered by `post_url`. |
| `get-post-engager` | GET | `readOnly` | Returns a single engager record (used by extension for status polling). |

Both `ingest-post-engager` and `enrich-post-engager` must be added to `auth.ts` `publicPaths`.

## Section 5 — Agent Skill: `post-engager-score`

Triggered by the agent after `enrich-post-engager` is called.

**Steps:**
1. Read enriched profile fields: name, role, company, headline, about, comment text.
2. Call `get-icp-sources` — load active ICP text.
3. Call HubSpot lookup — search for a contact by name, read XDR Owner custom field; fall back to contact owner field. Set `hubspot_status` to `found` or `new_opportunity`.
4. Score fit against ICP. Comment text is included as signal (substantive engagement = stronger indicator). Output: `strong / possible / weak / inconclusive` + one sentence of reasoning referencing specific ICP criteria.
5. Write verdict, HubSpot owner fields, and `hubspot_status` back to the `post_engagements` row. Set status `done`.

**Hard rules (inherited from app):**
- Never fabricate facts. Score only from what was captured.
- Do not draft a connection note — verdict only.

## Out of Scope

- Liker scraping (too brittle without LinkedIn API).
- Auto-drafting connection notes for engagers (user initiates via Profile tab).
- Filtering to only Builder.io / Steve Sewell posts — the extension works on any post the user navigates to; the user is responsible for which posts they visit.
- HubSpot contact creation for `new_opportunity` engagers (manual decision deferred to user).
