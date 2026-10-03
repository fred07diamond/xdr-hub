# Changelog

## 2026-10-02 (follow-ups)

- Follow-up cadences: after the first touch, each route gets its own
  follow-ups (for example day 1, 3, and 6 for exceptional leads). Edit the
  days and what each email is for in the playbook's new Follow-ups section
  (D101).
- The agent writes each follow-up the day before it is due. It shows on the
  lead page under Follow-ups, and the lead goes back to To do. Edit it,
  then Approve and send: it goes from your Gmail as a reply in the same
  thread. Skip one, or stop them all.
- Follow-ups stop on their own when the lead replies, books a meeting,
  opts out, or HubSpot moves them on.

## 2026-10-02 (send from Gmail)

- The lead's owner can now send the drafted reply from their own Gmail:
  "Approve and send" sends it (a second click confirms), "Approve" saves it
  to their Gmail Drafts to edit and send there (D96).
- Edit the drafted reply in place: change the subject or body, then Save
  changes. PA checks your edit against the message rules (D100).
- The draft card is cleaner: one row with Approve and send, Approve, and a
  More menu (Copy, Rewrite with the agent); the rules it follows sit under
  "Why it reads this way" (D100).
- Everyone sees "Approve and send" and "Approve" on a draft; they are
  greyed out unless you own the lead (D99).
- Your Gmail connection lives in Settings > Email: connect, reconnect,
  disconnect, and send yourself a test (D97, D99).
- A draft signed "[owner first name]" is signed with the sender's first
  name when it goes out (D98).
- Each person connects Gmail once from the draft card. Only the owner sees
  the buttons; everyone else sees who can send.
- PA never sends a lead twice, never sends a draft that breaks a message
  rule or still has a placeholder, and never emails a lead HubSpot already
  actioned. HubSpot logs the email through the owner's inbox sync.

## 2026-10-02 (cleanup)

- The sidebar is Inbound and Playbook (plus CRM connections and Settings).
  Labels and Ops, which were never built, are gone; Chat is off the sidebar
  (the agent panel stays on every page); Suggestions moved onto the
  Playbook page (D95).
- The Sales handbook moves into the playbook's Knowledge section: a banner
  on the Playbook page turns its docs into Knowledge blocks for you to
  approve. The handbook page is gone.

## 2026-10-02 (enterprise rotation)

- Every unowned enterprise lead (over 8,000 employees) with a real inquiry
  goes to the next Enterprise AE, whatever its tier, with that AE's meeting
  link (D93).
- The rotation is strict, one lead each in order, and Lead routing shows
  who is next up.

## 2026-10-01 (playbook catch-up)

- The playbook now spells out today's rules: QL as a stage and no MQL, SAL
  and Recycle decided in HubSpot, when PA suggests a recycle, what counts as
  a first touch, AE-owned accounts, and moved on (D92).

## 2026-10-01 (board sections)

- The inbound board is in sections: To do, Contacted, Moved on, and Not for
  PA, with the last two folded away (D90).
- A lead HubSpot moved on (SAL, S0, Recycle, Disqualified, or a deal created
  after the form) leaves the queue and is never worked again.

## 2026-10-01 (no decisions in PA)

- The decision bar is gone from leads, and the Needs decision tab, decision
  pills, and Decide on older leads button are gone from the board.
  Decisions are made in HubSpot, and PA follows HubSpot's stage (D89).

## 2026-10-01 (thin messages)

- A very short message with no question and next to no signal (for example
  "yes need a trial") suggests a recycle instead of Requires discovery: one
  clarification email, then recycle (D88).

## 2026-10-01 (rewrite reply)

- A Rewrite reply button rewrites just the drafted reply, first in the
  agent's queue, without re-running the lead (D87).
- Message rules and other playbook blocks updated in PA's code now reach
  the live playbook, except entries someone edited in the app.

## 2026-10-01 (acknowledgment)

- Every draft opens by thanking the person for reaching out and naming what
  they asked about, then the trigger, connection, and question, and closes
  "Looking forward to your response," (D86). Undecided drafts are being
  rewritten.

## 2026-10-01 (draft reasoning and quality)

- Every draft shows why it reads the way it does: the class and route, the
  trigger, connection, and question, how each of their asks is answered,
  and the tone (D85).
- Drafts keep all three TCQ parts, read professionally (no "Hey" or "Yep"),
  never use internal product names, and stay between 40 and 75 words.
  Undecided drafts are being rewritten.

## 2026-10-01 (SLA follows HubSpot)

- The SLA timer matches HubSpot: a lead recycled, made SAL, or disqualified
  in HubSpot shows that, and its decision shows as decided in HubSpot
  instead of counting down (D83).
- PA checks each open lead's HubSpot stage every 30 minutes.

## 2026-10-01 (partnerships and badge colors)

- A Partnerships role in Lead routing. An exceptional company asking about a
  partnership routes to Partnerships; anything less recycles with no email
  (D81).
- Classification badges have one color each and no dot, so Exceptional,
  Requires discovery, Suggest recycle, and the rest are easy to tell apart
  (D82).

## 2026-10-01 (AE-owned accounts)

- When an AE owns the account in HubSpot, PA does nothing: no draft, no
  decision, no SLA. HubSpot's existing workflow emails them (D80).
- An owner counts as an AE once they are in Lead routing as an Enterprise
  or Commercial AE; an unknown owner is flagged to set up.

## 2026-10-01 (lead routing settings)

- Settings, Organization has a Lead routing section: set the Commercial AE,
  add Enterprise AEs for the round robin, and keep each PA's meeting link,
  in one place (D79).

## 2026-10-01 (AE routing)

- Exceptional leads: owned by an AE goes to that AE; not owned and 8,000
  employees or fewer goes to the Commercial AE; not owned and bigger round
  robins across the Enterprise AEs, and the lead keeps its pick (D78).
- Team page roles: PA, Enterprise AE, Commercial AE, CSM. Pod AEs are gone.

## 2026-10-01 (commercial AE)

- Exceptional leads at commercial accounts (under 8,000 employees) go to the
  Commercial AE, unless the account already has its own AE (D77).
- Set the Commercial AE on the Team page, or from the lead the first time
  one is needed. The 8,000 line is in the playbook's Routing section.

## 2026-10-01 (playbook approvals)

- Playbook edits are approved by the owner or a Playbook admin, not RevOps
  or the PA team. Assign Playbook admins on the Team page. The owner can
  approve their own changes (D76).

## 2026-10-01 (sent emails on the board)

- Leads already emailed from HubSpot show that email on the board, subject
  and first lines, marked "Sent from HubSpot", instead of "No draft
  needed" (D75).

## 2026-10-01 (lead page reliability)

- The inbound list and lead page load much faster: each record is read
  once per page load instead of many times (D74).
- A brief "You do not have access to this workspace app" error is retried
  automatically instead of breaking the lead page.

## 2026-10-01 (first touch and AE setup)

- A first email that replies to the form notification ("re: your request")
  shows as the first touch again.
- When an exceptional lead has no AE, the Route box asks once who the PA's
  AE is, with their meeting link, and saves it as the PA's pod AE.

## 2026-10-01 (AE loop-in, meeting links, refresh)

- Exceptional leads loop in the AE: the AE is on Cc, named in the email,
  with the meeting's purpose and their meeting link on its own line (D72).
- When the routed person has no meeting link, the Route box asks for it
  once. It is saved to that person and never asked again.
- Refreshing a lead from HubSpot, by hand or automatically, no longer sends
  it back to "Waiting for the agent". The classification, the draft, and a
  route you picked stay (D73).

## 2026-10-01 (tone, and leads with no fit score)

- Drafts answer what the lead asked first (a call, a demo, pricing), skip
  the lecture, and ask at most two questions. The check flags any ask left
  unanswered. Undecided drafts are being rewritten (D71).
- A lead with no intent score counts as 0 and suggests a recycle. It gets
  one email asking them to clarify what they need, not a sequence.

## 2026-10-01 (lifecycle and fresh HubSpot data)

- No more "Verdict QL": every inbound lead starts as a QL, so the badge shows
  the qualification instead (Exceptional, Requires discovery, Suggest
  recycle) (D69).
- The sales cycle's next stage after QL reads "SAL or Recycle", and shows
  Recycle when the lead is recycled in HubSpot or declined in PA.
- PA's recommendation now matches the qualification; a lead that suggests a
  recycle is recommended for decline and recycle.
- New leads are read from HubSpot again at about 10 and 60 minutes, so the
  owner, intent score, name, and questionnaire answers catch up (D70).
- The classification card shows the full message as written, with their
  question underneath.

## 2026-10-01 (first touch, again)

- A reply in a thread is no longer shown as the first touch. The first touch
  is the first email sent to the lead (not a CC) that starts a conversation.
- When only a reply thread is in HubSpot, the card says the first email is
  not logged and that the lead was contacted, with the thread below.
- The first touch card lists who the email actually went to.
- Quoted earlier messages ("On ... wrote:" and lines starting with >) no
  longer show in email text.

## 2026-10-01 (qualification and first touch)

- Leads are now Exceptional or Requires discovery, from five signals: intent
  score, a clear enterprise need, headcount, budget, and multiple sign-ups.
  Three of five is Exceptional, which routes to the AE. An intent score of
  0 or 1 suggests a recycle (D67).
- The thresholds live in the playbook's Qualification section, so they can
  be changed there.
- The lead page shows the qualification with how many of the five signals
  are met, and the evidence for each.
- The first touch card now always shows the first email sent after the
  form, even on contacts with many emails (D68).

## 2026-10-01 (inbound sort and filter)

- The inbound board lists the newest request first by default, so a new
  Contact Sales lead lands at the top as soon as it is pulled. "Most urgent"
  keeps the old SLA order (breached, at risk, then by due time).
- Filter by when the lead was submitted: last 24 hours, 7 days, 30 days, or
  any time. The choice stays in the link, and next and previous on a lead
  follow it.
- Leads submitted in the last hour carry a New mark.
- The board refreshes every 30 seconds, so new leads appear without a
  reload.

## 2026-09-30 (routing after triage)

- Every lead now shows its route: route to the AE, PA takes the call, or
  qualify first, plus the customer, open deal, agency, and non-sales exits.
  You can change it on the lead; the draft is rewritten to match (D66).
- Meeting emails carry the meeting link of whoever takes the call: the
  account's AE, else the PA's pod AE, or the PA. No more day suggestions.
- The Team page has a Routing section: each person's role, meeting link, and
  a PA's pod AE, starting from the owners seen on leads.
- The board shows the route under each lead's class. The old routing text
  reads as the owner now ("Owner [name], who already owns the account"),
  which also fixes the owner's name showing twice.
- Playbook: a new Routing section with "Routing by class", and the owner
  assignment blocks moved to Ownership.

## 2026-09-30 (playbook page)

- The Playbook shows one section at a time, picked from a section list with
  block counts and a dot where something needs attention.
- Blocks read as a plain list: a name (for example "Highly Qualified
  Content") and a short preview. Ids, owning team, and enforcement moved
  into the block's editor; cards only flag what needs attention.
- The always-open block palette is gone; "Add block" on a section offers
  only the kinds that belong there. Drag to reorder still works.
- Release and role details moved into the menu next to the draft button.

## 2026-09-30 (messaging in the playbook)

- The drafting rules now live in the Playbook's Messaging section: the TCQ
  rubric, voice, choosing questions, a block for each Contact Sales class,
  the agency path, and a worked example. Edit them there; the next draft
  follows the change (D65).
- The first touch card no longer repeats PA's unsent draft under an email
  already sent from HubSpot.

## 2026-09-30 (first touch view)

- When the first email already went out from HubSpot, the lead shows it as
  "First touch, sent from HubSpot": To, From, Sent, Subject, and the body
  with its paragraphs and short links. PA's own draft sits underneath,
  collapsed, for comparison (D64).
- Email text in the contact history keeps its paragraphs, shows each link
  once, and leaves out the quoted reply chain.

## 2026-09-30 (contact history)

- Every lead shows its contact history from HubSpot: emails sent and
  received, calls, meetings, notes, and Dobby's message (D64).
- When someone already emailed the lead from HubSpot, PA shows that email in
  the draft card, marks first contact done on the SLA timer, and stops
  drafting a first touch.

## 2026-09-30 (refresh)

- "Refresh from HubSpot" on a lead and "Refresh all leads" on the board
  re-read leads from HubSpot and run them through today's rules, so older
  leads match new ones (D63).

## 2026-09-30 (TCQ rubric)

- Drafts are checked against the TCQ rubric: the trigger must be the lead's
  own words, no product pitch or filler, Enterprise-only for Content, real
  questions for Standard leads, two days for a meeting (D62).
- The agent drafts on Claude Sonnet, and undecided leads with older drafts
  are redrafted automatically.

## 2026-09-30 (the xDR master instructions)

- Each lead shows its Contact Sales class (Highly Qualified or Standard,
  Content or Code, or agency) with the criteria behind it (D61).
- The agent writes a lead brief before drafting: persona, deal role, the V2
  read, the five Stage 1 gates with the next move for each gap, and the next
  step. "Copy CRM note" formats it for HubSpot.
- Drafts follow the project's formula for each class.

## 2026-09-30 (automatic intake and the decision loop)

- New Contact Sales leads come in on their own, about a minute after they
  submit. No button needed (D58).
- Every lead routed to a rep gets a decision with PA's recommendation:
  accept and sequence, decline and recycle, or research more, or what to do
  with a booked meeting. 24 hours to decide; a miss is recorded and flagged,
  nothing happens on its own. "Decide on older leads" covers leads from
  before (D59).
- "Existing owner" is gone as a classification. Owned accounts are
  classified by the lead and get a draft for their owner; open deals and
  existing customers have their own labels.

## 2026-09-30 (real leads)

- PA pulls real Contact Sales submissions from HubSpot (read-only) and runs
  each through triage. The agent reads each message and drafts a reply that
  follows the Sales handbook. Nothing is sent (D54, D55).
- New on the board: "Pull new leads", when HubSpot was last read, and, for
  the app owner, "Turn on the inbound agent" (every 30 minutes).
- Drafts are checked against the handbook's email rules: no colons, under 75
  words when possible, a casual sign-off, no pricing, Builder not Builder.io.
- The Contact Sales response SLA is 30 minutes.

## 2026-09-30 (Sales handbook)

- New Sales handbook page in PA: the sales cycle, qualification, lead
  routing, personas, the email playbook, and sales stages, searchable and
  editable, with every version kept (D53).
- The drafting agent reads the handbook for voice and Contact Sales
  handling; the playbook still decides the rules.

## 2026-09-30 (SLA timer)

- The first-touch clock is now the SLA timer: it marks when a person
  contacted the lead and when it was marked SAL (D51).
- Each lead shows where it is in the sales cycle: MQL, QL, SAL, S0, NBM
  booked, NBM complete, S1.
- "Next step" moved to the bottom of the classification card, after the
  question it answers.
- "Open app" in Dispatch opens PA again (D52).

## 2026-09-30 (triage first)

- Each lead now opens on two things: how it was classified, and the drafted
  reply. The evidence (message, pre-check, route, scorecard, clocks,
  timeline) is one click away under Details (D49).
- The board shows the classification and the draft's subject and first lines
  on every row.
- PA drafts first-touch replies and checks them against the message rules.
  Nothing is sent automatically (D39).
- Inbound handling is the focus; the playbook builder is parked (D50).

## 2026-09-30 (block builder and CRM)

- The playbook is a block builder: drag typed blocks (country lists,
  thresholds, clocks, routing order, message rules, knowledge, the CRM
  mapping) into sections and edit them in place. Edits collect in a draft
  the owning teams approve (D46).
- A new owner-only page stores CRM tokens securely for every xDR Hub app, with
  OAuth for HubSpot and Salesforce (D47).
- Mapping PA's fields to HubSpot is a picker with type checks and suggested
  matches, approved by RevOps (D48).

## 2026-09-30 (dynamic playbook)

- The playbook is now edited in the app at `/playbook`, co-owned by the PA
  team and RevOps: change sets, checks, a replay of the impact, approval by
  the owning teams, and publishing a new release (D44).
- Changes that need something the app or the CRM lacks raise suggestions: a
  build request for the app owner, a CRM field for RevOps, a knowledge gap
  for the PA team. They show in `/suggestions`, the bell, and Slack once the
  PA Inbound app is set up (D45).
- The agent reviews every publish and the week's work, and can only draft and
  suggest.

## 2026-09-29 (xDR Hub merge)

- Merged into xDR Hub as `apps/pa` on the workspace's core 0.176.4 (D33,
  supersedes D1). Removed the standalone `netlify.toml` and release-migration
  script; pinned the toolkit.
- Ported the first build pass (D40). The schema is portable (SQLite locally,
  Postgres in production), JSON goes through one codec, and new integration
  tests run the repository on both dialects.
- Reused workspace infrastructure: the shared HubSpot client and roles (D35).
  Admin rights now come from the shared workspace role.
- Recorded: booking moves into PA later (D36), lead-triage stays separate
  (D37), 0.176.4 checks (D34, D38), and the open auto-respond question (D39).
- Hardened the core after a review (D41): owned accounts and active owners
  are never round-robined, unknowns fail closed, transient errors retry, one
  open engagement per contact, stricter evidence quotes, and untrusted name
  and company text is quoted and scanned. Opened D42 on intent versus
  ownership.
- Read the xDR Playbook in Notion and recorded how inbound runs today
  (CONTEXT) and ten differences from the kit (D43). Dobby already auto-sends,
  which reframes D39.

## 2026-09-30

- Fixed Settings: Integrations no longer freezes in a render loop, and
  "Back to App" returns to the page you came from. (D32)
- Fixed local workspace access: the Builder.io connection, app state, and
  live board data load in the preview again, through a pinned,
  development-only framework patch. (D32)

- Demo mode: a "Demo data" toggle on the Inbound board fills the board,
  records, and receipts with 14 made-up leads run through the real rules in
  the browser. Nothing is saved or sent. (D31)

- Replaced the Fusion starter with the Agent-Native 0.197.0 workspace
  (Dispatch, Chat, and the new `pa` app). Seeds merged. (D16, D17, D27)
- `pa_` schema (17 tables) and additive migrations. (D28)
- Build-time playbook compile to a content-hashed release, `287c16c3`, with
  12 pending confirmations. (D24)
- Core rules with unit tests; deterministic pipeline and synthetic replay.
  All seven seed cases match their expected pre-check, route, and verdict.
  (D20, D21, D23, D26)
- Read actions, `save-message-assessment`, `replay-submission`, and
  `navigation` and `selection` app state.
- Early M1 preview: inbound board, engagement record, receipts drawer, and
  Labels and Ops placeholders, all in shadow mode over synthetic data. (D22,
  D25)
- Route and verdict evals (7 of 7 pass); agent-step evals skipped until M1.
- Worked around two framework dev issues in app config: the agent panel
  crash and the eval CLI loader. Gateway data access needs `A2A_SECRET`.
  (D29)

## 2026-09-29

- Kickoff kit created: PRD, SPEC, OUTLINE, DECISIONS, SOURCES, CONTEXT, and seed files.
- D1 confirmed: a fresh `pa-hub` workspace, not an app inside xDR Hub.
