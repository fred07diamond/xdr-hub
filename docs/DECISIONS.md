# Builder.LI Decisions

Why the project is shaped the way it is. This exists so settled questions are not reopened, by a future agent or a future you. Each entry is a decision, the reasoning, and its status. The "why-nots" are as binding as the "whys."

---

## 1. No third-party LinkedIn sender (HeyReach, Expandi, Dripify, etc.)

**Decision:** Do not integrate any third-party outreach-sending SaaS.
**Why:** These tools exist because LinkedIn's official API does not expose connection requests, DMs, or comments to third parties. They work by browser-session emulation or proxy routing, which is against LinkedIn's User Agreement. Adding one moves ToS risk onto the user's account.
**Status:** Settled. Removed from the design entirely.

---

## 2. No auto-send, in any form

**Decision:** Builder.LI never sends connection requests or messages automatically. The human sends every one by hand.
**Why:** Same root cause as above. Automated sending at volume is exactly what LinkedIn's detection flags, and restrictions or bans land on the user's real, name-attached account. The user is early-career, weeks from an AE promotion, and uses this account as professional credibility. The downside is catastrophic and the upside (saving a few seconds per send) is small.
**Status:** Settled and structural. The manual send is not a limitation to engineer around later; it is the design.

---

## 3. No browser bot, screen-control agent, or extension that clicks

**Decision:** The extension reads the page the user is viewing and displays a draft. It does not click Connect, submit, auto-navigate, or loop.
**Why:** An extension that clicks, a computer-use agent driving the session, and a headless worker are mechanically identical to auto-send: they take an action LinkedIn does not permit third parties to take and disguise it as the user. The disguise is what detection catches. Dressing it as an extension does not reduce the risk; it relocates the violating code.
**Status:** Settled. This was explicitly requested and explicitly declined, with safe alternatives offered instead.

---

## 4. Manual send is the point, and it is cheap

**Decision:** Automate the entire pipeline (capture, fit-scoring, drafting, dedup, tracking); keep only the final click manual.
**Why:** The tedious 90% of outreach is the research and writing, not the click. Automating that and leaving a two-keystroke human send gives an automated-feeling workflow with zero account risk. For 15-20 contacts a day, the manual clicks are a few minutes.
**Status:** Settled. If the user ever wants truly lights-out volume, the recommended path is email (a channel with sanctioned sending APIs), not automating LinkedIn.

---

## 5. No API keys

**Decision:** Build with zero pasted API keys.
**Why:** The user has HubSpot Workflows access but no HubSpot API key, and no Apollo access. Rather than block on credentials, the design avoids them: contacts/profiles come from the extension reading the page, the AI engine runs through Connect Builder (OAuth via Agent-Native tokens), and Notion connects via OAuth.
**Status:** Settled. If HubSpot ingest is ever wanted, it is a CSV export (any tier) or, only on Data Hub Pro/Enterprise, a workflow webhook to the capture endpoint.

---

## 6. Thin extension, all judgment platform-side

**Decision:** The extension carries no ICP logic. It captures and displays. Fit-scoring and drafting happen in the Agent-Native app.
**Why:** The agent is the thing good at judgment, the ICP already lives in Notion (platform-side), and a dumb extension means ICP changes never require reshipping the extension. Only a LinkedIn markup change forces an extension update.
**Status:** Settled.

---

## 7. Draft round-trips into the extension panel

**Decision:** The drafted note comes back into the extension side panel, not into a separate app screen.
**Why:** The goal is to kill friction. Keeping the user on the profile, with the note appearing right there to copy, is the tightest workflow.
**Status:** Settled.

---

## 8. ICP read live from Notion, via a picker

**Decision:** ICP/persona docs live in Notion and are read live at draft time. The user picks which docs to use from a platform-side dropdown that allows selecting multiple docs, populated by a keyword search run each time the picker opens.
**Why:** A static ICP file goes stale the moment the Notion doc is edited. Reading live means the ICP is always current and edited where the user already works. Multi-select lets the user combine (for example) a core ICP doc plus a persona doc plus a disqualifiers doc. Keyword search each time avoids hardcoding page IDs and adapts as docs are added or renamed.
**Why not a fixed page:** Less flexible when the ICP spans multiple docs or when docs get added/renamed.
**Fallback:** If no docs are selected or Notion is unreachable, draft from the profile alone and flag "no ICP loaded" rather than failing.
**Status:** Settled. Depends on clean, searchable Notion doc titles.

---

## 9. AI runs through the agent, not inside actions

**Decision:** Drafting is an agent task, not a raw model call inside an action's `run()`.
**Why:** This is an Agent-Native framework rule. It means the capture endpoint is deterministic (store + trigger) and the draft is produced asynchronously by the agent, so the extension shows a brief spinner and polls `get-draft` for the result.
**Status:** Settled by the framework. Plan for the small async step rather than expecting the note in the capture response.

---

## 10. Public endpoints are minimal and will be secret-protected

**Decision:** Only the endpoints the extension needs (`capture-profile`, `get-draft`, `mark-sent`, `check-already-contacted`) are `publicAgent`. Once deployed off localhost, they get a shared-secret header.
**Why:** The extension calls cross-origin without the app's auth cookie, so those endpoints must be reachable unauthenticated. Keeping the set small and adding a secret in production limits exposure.
**Status:** Settled.

---

## 11. Human-paced usage only

**Decision:** One profile, one click, reads one page. Nothing auto-opens profiles or iterates over search results.
**Why:** Human-paced, human-triggered reading is the pattern LinkedIn tolerates. Bulk scraping, even for drafting, changes the risk profile and endangers the account.
**Status:** Settled.

---

## 12. Volume guideline: 15-20 per batch

**Decision:** Treat 15-20 sends as a sane daily guideline.
**Why:** Normal SDR behavior; keeps the manual workflow quick and the account well within human-plausible activity.
**Status:** Guideline, not a hard technical cap.

---

## 13. Name: Builder.LI

**Decision:** The project is Builder.LI (renamed early from an initial working name).
**Status:** Settled.

---

## Open items (not yet decided)

- Whether to add an optional weekly "requests sent" summary from send_history (nice-to-have, not required).
- Whether to keep an in-app history/dashboard view of captured prospects beyond the extension panel.
- Exact deployment target (Node vs Cloudflare vs Vercel vs Builder.io frame) once going off localhost.
