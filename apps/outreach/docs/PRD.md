# PRD: Builder.LI -- LinkedIn Outreach Automation

## 1. Document Control

| Field | Value |
|---|---|
| Product Name | Builder.LI |
| Author | Fred Diamond |
| Version | 1.1 |
| Date | July 17, 2026 |
| Status | Open questions resolved; decisions logged in Section 18 |
| Stakeholders | Fred (owner/operator), Sales leadership (policy approval), RevOps (HubSpot admin) |

---

## 2. Executive Summary

Builder.LI is a personal outreach automation system that turns a HubSpot contact list into an executed, personalized LinkedIn connection campaign with zero manual data handling. The user selects any HubSpot list from an in-app picker, the system pulls the contacts, enriches each with a verified LinkedIn profile URL via Apollo.io, renders everything in a review dashboard, and pushes the approved set into a HeyReach campaign that sends connection requests with a personalized note, followed by one follow-up message after acceptance.

The system is designed around three hard constraints: no direct Anthropic (Claude) API access (all agent and AI compute is funded by Agent-Native tokens), orchestration must run through Agent-Native Dispatch plus existing MCP connectors (HubSpot, Apollo, HeyReach), and batches are capped at 15-20 contacts to stay far inside LinkedIn safety limits.

Core value: an XDR currently spends significant manual time per week copying contact data, hunting LinkedIn profiles, and sending invites one at a time. Builder.LI compresses that into a select, review, and launch workflow measured in minutes, while keeping sending volume inside LinkedIn safety limits.

---

## 3. Problem Statement

Outbound LinkedIn prospecting today requires stitching together four disconnected steps:

1. Exporting or eyeballing contacts in HubSpot
2. Manually finding each prospect's LinkedIn profile
3. Writing a connection note per person
4. Sending invites by hand, with no tracking back into the CRM

This is slow, error-prone, and leaves no activity trail in HubSpot. LinkedIn's official developer platform does not expose connection requests, DMs, or invite-sending to third-party integrations, so no standard workflow tool (Zapier, Make, n8n) can close this gap natively. Purpose-built LinkedIn automation infrastructure (HeyReach) is required for the execution layer.

---

## 4. Goals and Success Metrics

### 4.1 Goals

1. Pull contacts from any user-selected HubSpot list with a single click
2. Achieve a verified LinkedIn URL for the majority of pulled contacts automatically
3. Send personalized connection requests without manual per-contact work
4. Keep all sending volume within LinkedIn-safe rate limits at all times
5. Log all outreach activity back to HubSpot contact timelines

### 4.2 Success Metrics (KPIs)

| Metric | Target | Measurement |
|---|---|---|
| Time from list selection to campaign launch | Under 10 minutes | Manual timing |
| LinkedIn URL enrichment match rate | 70%+ of contacts | Apollo response data |
| Connection request acceptance rate | 30%+ | HeyReach analytics |
| Reply rate on accepted connections | 10%+ | HeyReach analytics |
| Account restrictions or warnings | Zero | LinkedIn account status |
| Activities synced to HubSpot | 100% of sends | HubSpot timeline audit |

---

## 5. Non-Goals (Out of Scope for v1)

- Multi-sender / multi-account rotation (single LinkedIn account only)
- Email sequencing or multichannel outreach
- Automated reply handling or AI-drafted responses to inbound messages
- InMail campaigns
- Two-way HubSpot sync (one-way push from HeyReach to HubSpot only; two-way sync creates duplicate records)
- Automated writing of message copy via API calls (no Claude API access; templates are authored by the user, optionally drafted with AI assistance outside the app)

---

## 6. Users

**Primary user:** A single sales development rep (XDR) running their own outbound. Comfortable with HubSpot, Apollo, and technical tooling. Operates one LinkedIn account.

**Usage pattern:** 2-3 campaign launches per week, 15-20 contacts per batch (hard cap of 20, see FR-107), reviewed and approved manually before sending.

---

## 7. Solution Overview

### 7.1 Architecture

```
+-------------+      +------------------+      +---------------+      +------------+
|   HubSpot   |----->|  Builder.LI App  |----->|   Apollo.io   |----->|  HeyReach  |
|  (lists +   |      |  (dashboard UI)  |      |  (LinkedIn    |      | (campaign  |
|  contacts)  |      |                  |      |   URL enrich) |      |  execution)|
+-------------+      +------------------+      +---------------+      +-----+------+
       ^                                                                    |
       |                    activity sync-back                              |
       +--------------------------------------------------------------------+
                     (native HeyReach -> HubSpot integration)
```

### 7.2 Component Responsibilities

| Component | Role |
|---|---|
| HubSpot MCP | Source of truth. List discovery, contact retrieval, field data |
| Builder.LI dashboard | List picker, contact table, enrichment status, message composer, campaign launcher |
| Apollo.io | Person enrichment. Input: name + company/email. Output: verified LinkedIn profile URL |
| HeyReach | Execution layer. Receives leads + message template, sends connection requests within rate limits, fires webhooks on events |
| Agent-Native Dispatch | Orchestration. Chains the MCP calls (HubSpot pull, Apollo enrich, HeyReach push) as an agent workflow, since no direct Claude API is available |
| HeyReach native HubSpot integration | Sync-back. Logs sends, accepts, and replies as native activities on HubSpot contact timelines |

### 7.3 Data Flow (Happy Path)

1. App loads and fetches all HubSpot lists; user selects one from a dropdown
2. App pulls contacts from the selected list (name, title, company, email, phone)
3. For each contact missing a LinkedIn URL, Apollo bulk enrichment runs (batches of 10)
4. Dashboard displays results: matched URLs flagged green, unmatched flagged for manual review with a fallback LinkedIn search URL
5. User selects contacts via checkboxes, writes the connection note in the composer using dynamic variables, previews per-contact rendering
6. User clicks Launch; leads are pushed into a HeyReach campaign bound to the user's LinkedIn sender account
7. HeyReach sends connection requests on a drip schedule within daily/weekly caps, then sends one follow-up message 1-2 days after each acceptance (sequence stops immediately on reply)
8. HeyReach webhooks and the native HubSpot integration write activity back to contact timelines

---

## 8. Functional Requirements

Priority key: P0 = must have for launch, P1 = should have, P2 = nice to have.

### 8.1 FR-100: HubSpot Data Layer

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| FR-101 | P0 | On load, fetch and display all HubSpot contact lists (active and static) in a searchable dropdown | User sees list names and sizes; search filters by name |
| FR-102 | P0 | On list selection, retrieve all contacts in that list | Query uses list membership filtering (hs_crm_search.ilsListIds); handles pagination for lists over 100 contacts |
| FR-103 | P0 | Pull the following fields per contact: firstname, lastname, jobtitle, company, email, phone, hs_object_id | All five user-selected display fields render in the table; record ID retained for sync-back |
| FR-104 | P1 | Also pull any existing LinkedIn URL property if populated, to skip redundant enrichment | Contacts with an existing URL bypass Apollo |
| FR-105 | P1 | Display total contact count and flag contacts with missing critical fields (no first name or no company) | Missing-data contacts visually flagged; excluded from enrichment by default |
| FR-106 | P2 | Refresh button to re-pull the selected list without reloading the app | Table updates in place |
| FR-107 | P0 | Enforce a hard per-batch cap of 20 contacts (recommended 15-20) to minimize LinkedIn flagging risk; lists larger than the cap require the user to narrow selection | Enrich and Launch actions disabled while selection exceeds 20; live selection counter displayed |

### 8.2 FR-200: LinkedIn URL Enrichment

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| FR-201 | P0 | Enrich contacts via Apollo People Enrichment using name + company and/or email as match keys | Enrichment returns linkedin_url where matched |
| FR-202 | P0 | Batch enrichment in groups of up to 10 contacts per call (Apollo bulk endpoint limit) | No calls exceed 10 records; batches processed sequentially with rate-limit spacing |
| FR-203 | P0 | Handle "200 but no records enriched" responses as a no-match state, not an error | Unmatched contacts tagged Needs Review, never retried automatically |
| FR-204 | P0 | Fallback: for unmatched contacts, generate a LinkedIn people-search URL of the form linkedin.com/search/results/people/?keywords={first}+{last}+{company} | Clickable fallback link appears in the row; user can paste a verified URL manually |
| FR-205 | P1 | Show enrichment progress (X of Y enriched) and per-contact status badges: Matched, Needs Review, Skipped | Live progress indicator during enrichment |
| FR-206 | P1 | Manual URL entry field per row that validates the linkedin.com/in/ pattern | Invalid URLs rejected with inline error |
| FR-207 | P1 | Write enriched LinkedIn URLs back to the HubSpot contact record after each enrichment run | A confirmation modal lists every pending write (contact + URL); nothing is written to HubSpot until the user approves the batch |

### 8.3 FR-300: Dashboard and Contact Table

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| FR-301 | P0 | Sortable, filterable table with columns: checkbox, name, title, company, email, phone, LinkedIn URL, enrichment status | All columns sortable; filter by enrichment status |
| FR-302 | P0 | Select all / deselect all, plus per-row selection | Selection count shown; only Matched or manually verified contacts are selectable for launch |
| FR-303 | P1 | Deduplication check: flag contacts sharing the same LinkedIn URL or email within the batch | Duplicates flagged; only one instance selectable |
| FR-304 | P1 | Exclusion check against prior campaigns: warn if a contact was already sent a request in a previous Builder.LI batch | Requires lightweight send-history store (see FR-604) |
| FR-305 | P2 | CSV export of the enriched table (for manual HeyReach import as a fallback path) | Export matches HeyReach CSV import format with mapped custom variables |
| FR-306 | P1 | Detect contacts who are already first-degree connections (via HeyReach connection status) and flag them for manual review | Flagged rows carry an Already Connected badge, are excluded from launch by default, and require explicit per-row override to include |

### 8.4 FR-400: Message Composer

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| FR-401 | P0 | Text composer supporting dynamic variables: {{first_name}}, {{last_name}}, {{job_title}}, {{company}} | Variables resolve correctly in preview for every selected contact |
| FR-402 | P0 | Hard character counter enforcing LinkedIn's 300-character connection note limit, counted AFTER variable substitution against the longest resolved value in the batch | Launch blocked if any rendered message exceeds 300 characters |
| FR-403 | P0 | Per-contact preview pane showing the fully rendered note | User can page through previews before launch |
| FR-404 | P1 | Warn if the account is a free LinkedIn tier: free members are capped at roughly 5 personalized invite messages per month with a 200-character limit, so personalized notes at volume require Premium or Sales Navigator | Warning banner with tier selector; character cap adjusts to 200 if free tier selected |
| FR-405 | P1 | Save and load message templates (named, reusable) | At least 5 saved templates; stored via artifact persistent storage |
| FR-406 | P2 | Option to send connection requests with no note (blank invites), since blank invites are not subject to the personalized-invite monthly cap on free accounts | Toggle per campaign |
| FR-407 | P0 | Second composer field for the post-acceptance follow-up message with the same variable support and per-contact preview; the sequence is hard capped at exactly one follow-up in v1 | Follow-up renders in the preview pane alongside the connection note; soft warning above 300 characters (short messages perform best) |

### 8.5 FR-500: HeyReach Campaign Push

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| FR-501 | P0 | Push selected leads into a HeyReach campaign via the HeyReach API/MCP, with each lead carrying profileUrl (required minimum) plus personalization fields | All personalization variables map correctly |
| FR-502 | P0 | Target campaign must exist and be in an active (IN_PROGRESS) state before leads are added; the app surfaces a campaign picker listing existing HeyReach campaigns | Lead-add calls fail gracefully with instructions if the campaign is paused or finished; optional auto-resume flag exposed |
| FR-503 | P0 | Respect HeyReach's limit of up to 100 leads per add-leads call and the 300 requests/minute API rate limit | Batching logic enforced client-side |
| FR-504 | P0 | Bind every lead to the user's LinkedIn sender account ID (linkedInAccountId) as required by the API | Sender account fetched from campaign config, not hardcoded |
| FR-505 | P0 | Custom variable names sent to HeyReach must exactly match the variable names used in the HeyReach sequence; only alphanumeric characters and underscores (spaces auto-convert to underscores) | Variable name validation before push |
| FR-506 | P1 | Launch confirmation modal summarizing: campaign name, lead count, sender account, rendered sample message, and estimated days to complete at current daily cap | User must explicitly confirm before any leads are pushed |
| FR-507 | P2 | Create a new HeyReach campaign from within the app (name, linkedInAccountIds, campaignType OUTREACH) | Falls back to campaign picker if creation not supported by connected plan |
| FR-508 | P0 | The HeyReach sequence includes one follow-up message step configured to send 1-2 days after connection acceptance, and the sequence stops immediately if the prospect replies first | Verified end to end on a test lead before the first live batch |

### 8.6 FR-600: Tracking and Sync-Back

| ID | Priority | Requirement | Acceptance Criteria |
|---|---|---|---|
| FR-601 | P0 | Enable HeyReach's native HubSpot integration so connection requests sent, accepted, messages, and replies log as native activities on contact timelines | Verified events appear on at least one test contact before full launch |
| FR-602 | P1 | Dashboard status view: per-contact state (Queued, Sent, Accepted, Replied) sourced from HeyReach data | Status refresh on demand |
| FR-603 | P1 | Subscribe to HeyReach webhooks for CONNECTION_REQUEST_SENT, CONNECTION_REQUEST_ACCEPTED, and MESSAGE_REPLY_RECEIVED for real-time state | Webhook events update the send-history store |
| FR-604 | P1 | Maintain a lightweight send-history store (contact ID, LinkedIn URL, campaign, date) to power dedup and exclusion checks | Persisted across sessions |
| FR-605 | P2 | Weekly summary: sends, accepts, replies, acceptance rate trend | Rendered as a simple chart in the dashboard |

---

## 9. Non-Functional Requirements

| ID | Category | Requirement |
|---|---|---|
| NFR-1 | Safety | The system must never exceed 20-30 connection requests per day or 100 per week per LinkedIn account. These are hard ceilings enforced at the HeyReach campaign level, and the app must display remaining daily/weekly budget |
| NFR-2 | Safety | New or cold LinkedIn accounts follow a warm-up ramp before automation: roughly 5-10 manual requests/day in week one, 10-15 in week two, 15-20 in week three if acceptance stays above 30%, then automation at reduced pace |
| NFR-3 | Reliability | Every external call (HubSpot, Apollo, HeyReach) wrapped in retry-with-backoff for 5xx errors; 4xx errors surface actionable messages, never silent failures |
| NFR-4 | Performance | List pull and table render for 200 contacts completes in under 15 seconds; enrichment progress streams incrementally rather than blocking |
| NFR-5 | Security | No credentials stored in the app UI or artifact code. All API keys live in the respective MCP connector configurations (HubSpot, Apollo, HeyReach). No contact PII placed in URL query strings |
| NFR-6 | Auditability | Every launch logged: timestamp, list name, lead count, campaign ID, message template used |
| NFR-7 | Cost control | Apollo enrichment consumes credits per matched record; the app shows estimated credit consumption before enrichment runs and requires confirmation |
| NFR-8 | Usability | Full workflow operable without leaving the app except for initial HeyReach campaign/sequence setup |

---

## 10. Technical Architecture and Integration Specs

### 10.1 Constraint: No Claude API

Message generation cannot call the Anthropic API from within the app. Implications:

- Connection note copy is template-based with variable substitution, authored by the user
- Any AI-assisted drafting (e.g., generating template variants) happens through Agent-Native Dispatch agent runs or in a separate Claude chat, with output pasted into the composer
- All in-app logic (rendering, validation, batching) is deterministic client-side code
- All agent workflow compute is billed to Agent-Native tokens; there is no Claude API dependency or cost anywhere in the system

### 10.2 Orchestration: Agent-Native Dispatch

Agent-Native Dispatch is the workflow engine connecting the MCP servers. The core pipeline is a dispatched agent task:

```
Task: "outreach-batch"
  Step 1: HubSpot MCP -> query contacts by list ID
  Step 2: Apollo MCP  -> bulk people enrichment (batches of 10)
  Step 3: Return enriched dataset to dashboard for human review
  Step 4 (post-approval): HeyReach MCP/API -> add leads to campaign
```

Human review between steps 3 and 4 is mandatory. The agent never launches sends without explicit user confirmation (FR-506).

### 10.3 Integration Specifications

**HubSpot (MCP, already connected)**
- List discovery: lists endpoint or SQL query surface
- Contact pull: search/query with list membership filter, properties limited to the seven required fields
- Sync-back is handled by HeyReach's native integration, not by this app (except optional FR-207 URL write-back, which requires user confirmation per write)

**Apollo.io (MCP connector available)**
- Endpoints: People Enrichment (single) and Bulk People Enrichment (up to 10 people per call)
- Match keys supplied: first_name, last_name, organization name, email where available; richer inputs produce higher match rates
- Response field consumed: linkedin_url
- Do not request reveal_personal_emails or reveal_phone_number (unnecessary for this use case and consumes extra credits / triggers webhook requirements)
- Handle rate-limit (429) responses with fixed-window backoff

**HeyReach (account + API key required)**
- Auth: API key generated under Integrations > HeyReach API
- Add leads: up to 100 lead + sender pairs per call; each lead requires profileUrl at minimum; campaign must be ACTIVE (IN_PROGRESS)
- API rate limit: 300 requests/minute
- Campaign creation payload: name, linkedInAccountIds, campaignType: OUTREACH
- Custom variables: alphanumeric and underscores only; must exactly match sequence variable names
- Webhooks: subscribe to CONNECTION_REQUEST_SENT, CONNECTION_REQUEST_ACCEPTED, MESSAGE_REPLY_RECEIVED
- Native HubSpot integration: enable via HeyReach Integrations screen; creates a HeyReach property group (~20 properties) in HubSpot and logs 12 LinkedIn activity types to contact timelines; run as one-way push (HeyReach to HubSpot)

### 10.4 Frontend

- Single-file React artifact (dashboard) using in-memory state plus artifact persistent storage for templates and send history
- No localStorage/sessionStorage (unsupported in artifacts)
- Table, composer, preview, and launch modal as the four primary views

---

## 11. Data Requirements

### 11.1 Field Mapping

| HubSpot Property | App Field | Apollo Input | HeyReach Variable |
|---|---|---|---|
| firstname | First Name | first_name | first_name |
| lastname | Last Name | last_name | last_name |
| jobtitle | Job Title | (context only) | job_title |
| company | Company | organization_name | company |
| email | Email | email (match key) | email_address |
| phone | Phone | (not sent) | (not sent) |
| hs_object_id | Record ID | (not sent) | (stored for sync mapping) |
| (Apollo output) | LinkedIn URL | linkedin_url | profileUrl (required) |

### 11.2 Data Quality Rules

1. Contacts missing first name AND last name: excluded entirely
2. Contacts missing company AND email: excluded from Apollo (insufficient match signal), sent to manual review with fallback search URL
3. Duplicate LinkedIn URLs or emails within a batch: only first instance eligible
4. Contacts present in send history: excluded by default, overridable per row
5. LinkedIn URL format validation: must match linkedin.com/in/ pattern before push

---

## 12. Rate Limits, Safety, and Compliance

### 12.1 Consolidated Limits Table

| Layer | Limit | Enforcement |
|---|---|---|
| Builder.LI batch size | 15-20 contacts per batch (hard cap 20) | App-side validation (FR-107) |
| LinkedIn connection requests | 20-30/day, max ~100/week | HeyReach campaign settings (hard ceiling) |
| LinkedIn messages | ~150/week | HeyReach (v1 sends one follow-up per accepted connection) |
| Personalized invite note length | 300 characters (Premium/Sales Nav); ~200 characters and ~5/month on free accounts | App-side validation (FR-402, FR-404) |
| Apollo bulk enrichment | 10 people per call; per-minute/hour/day fixed rate windows | App batching + backoff |
| HeyReach API | 100 leads per add call; 300 requests/minute | App batching |

### 12.2 Compliance and Risk Notes

1. **LinkedIn Terms of Service.** Automated activity on personal LinkedIn accounts violates LinkedIn's User Agreement regardless of tool. Cloud-based execution and conservative volumes reduce but do not eliminate restriction risk. The account owner accepts this risk explicitly; the app displays a one-time acknowledgment.
2. **Employer policy.** Because this runs against a company CRM and a company-affiliated LinkedIn profile, confirm with sales leadership / RevOps that automated LinkedIn outreach is approved before first launch.
3. **Data privacy.** Contact PII stays within the connected systems (HubSpot, Apollo, HeyReach). No PII in URLs, logs, or third-party endpoints beyond the three integrated platforms. Respect GDPR constraints Apollo enforces on personal emails (not requested in this design).
4. **Account tier.** LinkedIn Premium or Sales Navigator is strongly recommended; free-tier personalized invite caps make personalized outreach at volume impractical.

---

## 13. Prerequisites and Dependencies (Requirements Needed Before Build)

| # | Requirement | Status | Notes |
|---|---|---|---|
| 1 | HubSpot MCP connector with contact + list read scopes | In place | Already connected |
| 2 | At least one HubSpot contact list (active or static) containing target prospects | Verify | Lists must exist to appear in picker |
| 3 | Apollo.io account with available enrichment credits | Verify | Credits consumed per matched record; estimate ~1 credit per contact |
| 4 | HeyReach paid account | Needed; confirm funding | Growth plan, $79/seat/month, 14-day trial. Agent-Native tokens cover agent compute only; the HeyReach seat is a separate SaaS subscription unless already in the company stack |
| 5 | HeyReach API key | Needed | Generated in HeyReach under Integrations |
| 6 | LinkedIn account connected as a sender inside HeyReach | Needed | Single account for v1; note its linkedInAccountId |
| 7 | An active HeyReach campaign with a sequence containing the connection-request step and matching variable names | Needed | Campaigns must be created in HeyReach before leads can be added via API |
| 8 | HeyReach native HubSpot integration enabled | Needed | For sync-back (FR-601); custom property syncing may require Operations Hub Starter or above |
| 9 | Agent-Native Dispatch configured with HubSpot, Apollo, and HeyReach access, with sufficient token balance | Needed | Orchestration layer; all AI and agent compute billed to Agent-Native tokens (no Claude API) |
| 10 | LinkedIn Premium or Sales Navigator subscription | Recommended | Removes free-tier personalized invite caps |
| 11 | Sales leadership / RevOps approval for automated outreach | Needed | Policy gate before first live send |
| 12 | Warm LinkedIn account (regular recent activity, completed warm-up ramp if previously dormant) | Verify | Per NFR-2 |

---

## 14. User Flow

1. **Open app.** Lists load automatically into the picker with names and counts.
2. **Select list.** Contacts pull and populate the table with the five display fields.
3. **Enrich.** Click Enrich; Apollo runs in batches with a live progress bar and estimated credit cost confirmation up front. After enrichment, a confirmation modal offers to write the new LinkedIn URLs back to HubSpot.
4. **Review.** Sort by status. Fix Needs Review rows via fallback search links and manual URL entry. Narrow the selection to 20 contacts or fewer. Already Connected flags, dedup, and history warnings resolve here.
5. **Compose.** Write both the connection note and the follow-up message, watch the character counter against the worst-case rendered length, page through per-contact previews of both steps.
6. **Launch.** Pick the target HeyReach campaign, confirm the summary modal (count, sender, sample message, estimated completion days), and confirm.
7. **Monitor.** Status view updates as HeyReach sends; accepts and replies flow to HubSpot timelines automatically.

Alternate paths: CSV export instead of API push (FR-305); blank-invite mode (FR-406); skip enrichment for lists that already carry LinkedIn URLs (FR-104).

---

## 15. Error Handling and Edge Cases

| Case | Behavior |
|---|---|
| Selected list is empty | Friendly empty state with link back to picker |
| List exceeds the 20-contact batch cap | Full list loads for browsing, but Enrich and Launch stay disabled until the selection is narrowed to 20 or fewer; app suggests splitting into sequential weekly batches |
| Apollo returns 200 with no records enriched | Contact marked Needs Review; no automatic retry (this is a no-match, not a failure) |
| Apollo 429 rate limit | Pause batch, backoff to next fixed window, resume automatically |
| HeyReach campaign paused or finished | Block push; show instructions, offer auto-resume flag where supported |
| HeyReach add-leads partial failure | Report exact failed leads; successfully added leads are not re-sent |
| Variable in template has empty value for a contact | Flag contact in preview; block launch until resolved or contact deselected |
| Rendered message over character cap for any contact | Launch blocked; offending contacts listed |
| Duplicate lead already in HeyReach campaign | HeyReach dedupes by profile URL; app surfaces the skip count post-push |
| MCP connector auth failure | Actionable error naming which connector needs re-authentication |

---

## 16. Phased Delivery Plan

| Phase | Scope | Exit Criteria |
|---|---|---|
| Phase 1: MVP | List picker, contact pull, table, fallback search URLs, CSV export for manual HeyReach import | One full batch executed end-to-end via CSV |
| Phase 2: Enrichment | Apollo bulk enrichment, status badges, manual URL entry, dedup | 70%+ auto-match rate on a real list |
| Phase 3: Direct push | Two-step message composer (connection note + follow-up) with previews and caps, HeyReach API push, launch confirmation | Campaign launched entirely in-app with both sequence steps; zero manual CSV steps |
| Phase 4: Tracking | Webhooks, send-history store, status view, HubSpot sync verification, weekly summary | Accepts and replies visible in dashboard and on HubSpot timelines |

---

## 17. Risks and Mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| LinkedIn account restriction | Medium | High | Hard caps (NFR-1), warm-up ramp (NFR-2), cloud-based sending, single conservative sender |
| Low Apollo match rate on niche personas | Medium | Medium | Fallback search URLs + manual entry keep the workflow unblocked |
| HeyReach plan cost not justified by volume | Low | Low | 14-day trial validates acceptance/reply rates before committing |
| Template variables mismatch HeyReach sequence | Medium | Medium | FR-505 pre-push validation of variable names |
| Employer policy conflict | Low | High | Prerequisite #11 approval gate before first live send |
| Apollo credit burn on large lists | Medium | Low | NFR-7 pre-enrichment cost estimate and confirmation |

---

## 18. Decision Log (Resolved Open Questions)

| # | Question | Decision (July 17, 2026) |
|---|---|---|
| 1 | Initial target lists and size | Target lists kept to roughly 15-20 contacts, and the app enforces a matching hard cap of 20 per batch, specifically to minimize LinkedIn flagging risk. Larger lists are worked in sequential batches (FR-107) |
| 2 | Cost and compute model | All AI and agent compute runs on Agent-Native tokens; no Claude API anywhere. The HeyReach subscription itself is a separate SaaS line item; confirm whether it is covered by the existing stack (Prerequisite #4) |
| 3 | Write enriched URLs back to HubSpot | Yes, gated behind a per-batch confirmation modal before any CRM write (FR-207, elevated to P1) |
| 4 | Follow-up message in v1 | Yes. One follow-up message sent 1-2 days after acceptance, hard capped at one step (FR-407, FR-508). Data shows connection notes and prompt follow-ups nearly double reply rates after the accept |
| 5 | Already-connected contacts | Flag for manual review with an Already Connected badge; excluded from launch by default, per-row override available (FR-306) |

---

## 19. References

1. HeyReach add-leads API constraints (100 leads/call, profileUrl required, active campaign, 300 req/min): https://www.scalekit.com/connectors/heyreach
2. HeyReach campaign creation payload and endpoints: https://cotera.co/docs/reference/tools/individual-tools/hey-reach
3. HeyReach custom variable naming rules and active-campaign requirement: https://university.clay.com/docs/heyreach-integration-overview
4. HeyReach webhook event catalog: https://docs.getcargo.ai/integration/hey-reach
5. HeyReach native HubSpot integration (property group, activity logging): https://www.heyreach.io/blog/hubspot-integration-is-live and https://help.heyreach.io/en/articles/15377434-heyreach-contact-activities-in-hubspot
6. One-way sync recommendation and Operations Hub note: https://moderninbound.com/blog/heyreach-hubspot-integration-guide
7. Safe sending limits (20-30/day, ~100/week): https://www.socialpilot.co/linkedin-automation-tools
8. Warm-up ramp schedule: https://overloop.com/blog/8-best-ai-linkedin-outreach-tools
9. Free-tier personalized invite caps and HeyReach pricing: https://www.linkedhelper.com/blog/best-linkedin-automation-tools/
10. LinkedIn official API does not expose connection/DM actions to third parties: https://linkupapi.com/blog-articles/how-to-connect-zapier-agents-to-linkedin
11. Apollo People/Bulk Enrichment behavior (10 per call, match keys, no-match 200s, credits): https://docs.apollo.io/reference/bulk-people-enrichment and https://generect.com/blog/apollo-enrichment-api/
12. Follow-up timing and sequence caps (first follow-up 1-2 days post-accept; 2-3 step sequences max): https://www.brandjet.ai/blog/when-to-follow-up-linkedin-messages/ and https://www.heyreach.io/blog/how-to-follow-up-on-linkedin
13. Connection note impact on post-accept reply rates (nearly doubles, across 20M+ requests): https://expandi.io/blog/linkedin-connection-message-templates/
