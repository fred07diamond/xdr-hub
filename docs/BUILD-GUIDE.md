# Builder.LI Build Guide

Current, authoritative build steps. Supersedes all earlier drafts (HeyReach, Apollo, CSV). Read CLAUDE.md first for the architecture and the hard boundaries. Read DECISIONS.md for why the project is shaped this way.

The loop:

```
open a LinkedIn profile -> extension reads it -> click "Draft note"
-> platform scores fit + drafts using ICP docs pulled live from Notion
-> draft returns to the extension panel -> user clicks Connect, pastes, sends
```

No API keys. Notion connects via OAuth. The extension only reads and displays; the human sends. Steps numbered continuously.

---

## Credentials

None to paste. AI engine runs through Connect Builder (already connected). Notion connects via OAuth through Dispatch (Phase 2). That is the whole list.

---

## What is already done

- Workspace scaffolded (Dispatch + `outreach` app), `pnpm install` and `pnpm dev` working, AI engine connected
- PRD in the repo (historical)
- Old `AGENTS.md` and skill written (replace them, Phase 2)
- `visual-plan` skill installed

Project root: `/Users/freddiamond/builder-li/builder-li`. App: `apps/outreach`. Resume at Phase 2.

---

## Phase 1: Scaffold (done)

Nothing to do. Dispatch stays; it is where Notion gets connected and it holds the connection grant for the app.

---

## Phase 2: Connect Notion and replace the instruction files (Steps 1-5)

**Step 1. Connect Notion via OAuth in Dispatch.** Open Dispatch (from `pnpm dev`), go to the connections/integrations area, and connect Notion. This uses the connect-once model: the account is recorded, the token lands in the vault, and no key is pasted into code. Then grant the `outreach` app access to that connection so its agent can call the Notion MCP tools.

(If you connect Notion via a workspace `mcp.config.json` instead of Dispatch, that also works; Dispatch is the recommended home since you already run it. The point is the `outreach` agent must be able to call `mcp__notion__search` and `mcp__notion__fetch`.)

**Step 2. Replace `AGENTS.md`** with the version in this package (`apps/outreach/AGENTS.md`). It encodes the no-send boundary and the "draft from selected Notion docs" behavior.

**Step 3. Add the `profile-draft` skill** from this package at `apps/outreach/.agents/skills/profile-draft/SKILL.md`.

**Step 4. Remove the stale skill** if present:

```bash
rm -rf apps/outreach/.agents/skills/outreach-batch
```

**Step 5. Verify:**

```bash
cat apps/outreach/AGENTS.md
cat apps/outreach/.agents/skills/profile-draft/SKILL.md
```

---

## Phase 3: Data layer (Steps 6-7)

**Step 6.** In the `outreach` app chat:

> Create the Drizzle schema in server/db/schema.ts. Tables: prospects (id, profile_url unique, name, headline, role, company, about, recent_activity, fit_verdict, fit_reason, draft_note, draft_follow_up, status [captured / drafted / sent], created_at, updated_at) and send_history (id, profile_url, sent_at). Also add a settings/app-state place to store the selected ICP Notion page IDs as a JSON array (with their titles for display). Use the framework schema helpers from @agent-native/core/db/schema.

**Step 7.** Apply and confirm:

```bash
pnpm action db-schema
```

---

## Phase 4: Actions (Steps 8-15)

Build in `apps/outreach/actions/`, one at a time, CLI-testing each. Each becomes `POST /_agent-native/actions/<name>` automatically.

**Step 8. `capture-profile`** (the extension's main endpoint):

> Create a capture-profile action. Input: profileUrl (required), name, headline, role, company, about, recentActivity (optional strings). Upsert a prospects row keyed on profileUrl with status "captured", then trigger the agent to score fit and draft a note via the profile-draft skill, writing fit_verdict, fit_reason, draft_note, draft_follow_up back and setting status "drafted". AI must run through the agent, not a raw model call in run(). The extension calls this cross-origin without an auth cookie, so set publicAgent expose true and keep it to this single ingest purpose.

**Step 9. `get-draft`** (polled by the extension):

> Create a get-draft action, http GET, readOnly, publicAgent expose true. Input: profileUrl. Returns status, fit_verdict, fit_reason, draft_note, draft_follow_up for that prospect.

**Step 10. `mark-sent`:**

> Create a mark-sent action, publicAgent expose true. Input: profileUrl. Sets status "sent" and inserts a send_history row.

**Step 11. `check-already-contacted`** (optional):

> Create a check-already-contacted action, http GET, readOnly, publicAgent expose true. Input: profileUrl. Returns whether a send_history row exists.

**Step 12. `search-notion-docs`** (populates the ICP picker):

> Create a search-notion-docs action. Input: keyword. It calls the Notion MCP search tool (mcp__notion__search) and returns a compact list of matching pages: title and page id only. This backs the ICP source dropdown.

**Step 13. `set-icp-sources` and `get-icp-sources`:**

> Create set-icp-sources (input: array of Notion page IDs plus titles; saves them as the active ICP selection in settings/app-state) and get-icp-sources (http GET, readOnly; returns the current selection).

**Step 14. Make `profile-draft` read the selection.** The skill (from this package) already instructs the agent to: read the selected Notion page IDs via get-icp-sources, fetch each with mcp__notion__fetch, combine them into the ICP context, and score/draft against that. Confirm the drafting step in capture-profile actually invokes this skill.

**Step 15. CLI test the brain** before the extension exists:

```bash
pnpm action set-icp-sources '{"sources":[{"id":"<notion-page-id>","title":"ICP"}]}'
pnpm action capture-profile '{"profileUrl":"https://linkedin.com/in/test","name":"Jane Doe","headline":"VP Sales at Acme","company":"Acme"}'
pnpm action get-draft --profileUrl "https://linkedin.com/in/test"
```

Confirm get-draft eventually shows status "drafted" with a note that reflects your Notion ICP content. If it does, the platform works end to end without the extension.

---

## Phase 5: ICP source picker UI (Steps 16-17)

**Step 16.** Build the picker screen in the app:

> Build an "ICP Sources" screen. A keyword search box calls search-notion-docs and shows results as a multi-select list (title + a checkbox). Selecting items and saving calls set-icp-sources. Show a summary of the currently active sources (from get-icp-sources) at the top. Use useActionQuery/useActionMutation on those actions.

**Step 17.** Confirm the loop: search a keyword, see your Notion ICP docs, select two or three, save, and confirm the summary updates. Re-run a capture (Step 15) and confirm the draft now reflects the combined selected docs.

---

## Phase 6: Build the Chrome extension (Steps 18-22)

Have the agent scaffold the files in `apps/outreach/extension/`; load unpacked into Chrome. Manifest V3.

**Step 18. Scaffold:**

> Scaffold a Manifest V3 Chrome extension in apps/outreach/extension/. Files:
> - manifest.json: manifest_version 3; name "Builder.LI"; permissions ["activeTab","storage","sidePanel"]; host_permissions ["https://www.linkedin.com/*","http://localhost/*"]; content script matching https://www.linkedin.com/in/*; a service worker background; the side panel; an options page.
> - content.js: reads the profile DOM into an object (name, headline, role, company, about, recent activity). Keep all selectors in one clearly labeled block since LinkedIn markup changes.
> - panel.html + panel.js: side panel UI. "Draft note" button, fit-verdict area, drafted note in a textarea with a Copy button, follow-up area, "Mark sent" button.
> - background.js (service worker): receives captured data from the panel, POSTs to {appUrl}/_agent-native/actions/capture-profile, polls {appUrl}/_agent-native/actions/get-draft until status drafted, returns the draft to the panel. Reads appUrl from chrome.storage.
> - options.html + options.js: one field to save the app URL into chrome.storage.

**Step 19. Load it:** chrome://extensions -> Developer mode on -> Load unpacked -> select `apps/outreach/extension/`. Open its options, paste the `outreach` app dev URL (from `pnpm dev`, not Dispatch), save.

**Step 20. Flow when on a profile:** open side panel -> "Draft note" -> content.js scrapes -> background.js POSTs and polls -> panel shows verdict + note + copy -> you Connect, paste, send -> "Mark sent".

**Step 21. CORS check:** cross-origin calls must originate in background.js (service worker), not content.js. If you see CORS errors, confirm that and that the options URL matches exactly (protocol, host, port).

**Step 22. Dedup warning (if you built Step 11):** have the panel call check-already-contacted on load so it warns you on profiles you already contacted.

---

## Phase 7: Test on a real profile (Steps 23-25)

**Step 23.** With `pnpm dev` running and the extension loaded, open a real LinkedIn profile of someone you would reach out to. Make sure you have selected ICP sources (Phase 5) first.

**Step 24.** Click "Draft note". Confirm the fit verdict appears and the note references something real from the profile in your ICP's voice. Generic output means either your Notion ICP docs need more voice/detail, no sources are selected, or the content script is not capturing About/activity, check what it scraped.

**Step 25.** Do one real send: Connect, paste, send, "Mark sent". Revisit the profile and confirm the already-contacted warning fires.

---

## Phase 8: Harden and deploy (Steps 26-28)

**Step 26. Selector maintenance.** The scraping block in content.js is the one thing that breaks over time as LinkedIn changes markup. Empty capture -> look there first.

**Step 27. Deploy** when ready. Nitro compiles to Node, Cloudflare Workers, Vercel, or Netlify, or use the Builder.io cloud frame. After deploy, update the extension options with the deployed URL, and protect the publicAgent endpoints with a shared secret header the extension sends and the actions verify (skip for localhost-only use).

**Step 28. Notion connection in production.** Confirm the Notion connection and the `outreach` grant carry over to the deployed environment so live drafting still reads your ICP docs.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| Capture comes back empty | LinkedIn markup changed; update the selector block in content.js |
| CORS error | Calls must originate in background.js, not content.js; confirm host_permissions and the exact app URL in options |
| get-draft never reaches "drafted" | Drafting task not firing; confirm capture-profile triggers agent work (not a raw model call) and the profile-draft skill is present |
| Endpoint returns 401/403 to the extension | capture-profile / get-draft / mark-sent need publicAgent expose true |
| Picker shows no docs | Notion not connected/granted to outreach, or the keyword does not match your doc titles; keep ICP doc titles clean |
| Draft ignores ICP | No sources selected, or profile-draft is not fetching them; confirm get-icp-sources returns a selection and the skill fetches each via mcp__notion__fetch |
| Notes are generic | Add voice and detail to the Notion ICP docs; confirm About/activity are captured |

---

## Reference links

- Actions and the HTTP mount: https://www.agent-native.com/docs/actions
- Workspace connections (connect-once, Notion provider): https://www.agent-native.com/docs/workspace-connections
- MCP clients (adding tools like Notion): https://www.agent-native.com/docs/mcp-clients
- Dispatch: https://www.agent-native.com/docs/dispatch
- Chrome extensions (Manifest V3): https://developer.chrome.com/docs/extensions/develop
