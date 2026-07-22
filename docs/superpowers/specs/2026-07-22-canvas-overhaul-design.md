# Canvas Overhaul Design Spec
_Date: 2026-07-22_

## Overview

A comprehensive overhaul of the Builder.LI messaging canvas introducing: a Figma-style multi-canvas tab system with universal starter templates, a Company node with live internet research, an extension canvas picker, a message preview panel, a right-click AI node action menu, and improved node deletion UX.

This is Spec 1 of 2. Spec 2 covers the Prospect page follow-up system and the LinkedIn redirect bug fix.

---

## 1. Canvas Tab System

### Data model

**New table: `messaging_canvases`**

| column | type | notes |
|---|---|---|
| `id` | text PK | |
| `name` | text | user-editable display name |
| `template_slug` | text nullable | `"account"` / `"role"` / `"prospect"` / `"blank"` / `null` |
| `is_system` | integer | `1` = read-only global template, `0` = user-owned canvas |
| `owner_email` | text nullable | null for system templates |
| `created_at` | text | |
| `updated_at` | text | |

**Changes to existing tables:**
- Add `canvas_id` (text, nullable) to `messaging_nodes`
- Add `canvas_id` (text, nullable) to `messaging_edges`
- Migration: backfill existing `messaging_nodes` and `messaging_edges` rows to a new auto-created "My Canvas" for each unique non-null `owner_email`. Existing shared persona nodes (`owner_email = null`) are migrated into the "Prospect Messaging" system template canvas so they remain accessible as template scaffolding.

**System template seeding:**
- 4 system canvases seeded at app startup with `is_system = 1` and `owner_email = null`
- Template nodes are seeded into `messaging_nodes` with the appropriate `canvas_id`
- System template rows are never deleted or modified by user actions

### Tab bar UI

- Tab bar sits above the React Flow canvas in the `/messaging` route
- Tab order: system templates first (with a lock icon, not deletable), then user canvases ordered by `created_at`, then a `+` button
- Active tab is highlighted; inactive tabs are muted
- **Rename:** double-click a tab label → inline text input → blur or Enter to save
- **Delete:** hover a user-owned tab → X button appears in the top-right corner of the tab → click X → confirmation dialog ("Delete this canvas? This cannot be undone.") → confirmed → canvas and all its nodes/edges are deleted. System template tabs have no X.

### Template picker modal

Appears in exactly two situations:
1. **First visit** — user has no canvases yet; canvas area shows an empty state with a prompt to get started
2. **Pressing `+`** in the tab bar

The modal presents 4 options:
- **Account Messaging** — for building messaging around a specific company or account plan
- **Role Messaging** — for targeting a specific job function or seniority level
- **Prospect Messaging** — for one-to-one personalized outreach to an individual
- **Blank** — empty canvas, start from scratch

Selecting a template:
1. Copies the system template's nodes into a new user-owned canvas
2. Names it after the template (auto-increments if name already exists: "Role Messaging 2")
3. Switches to the new canvas

### Starter template node sets

Each system template is pre-populated with the following locked nodes (rendered with a muted border and lock indicator):

| Template | Pre-populated nodes |
|---|---|
| Account Messaging | Company node, Tone, Value Props, Phrase Rules |
| Role Messaging | Role node, Tone, Value Props, Phrase Rules, Example |
| Prospect Messaging | Persona node, Tone, Phrase Rules, Example |
| Blank | (none) |

When copied into a user canvas, all nodes become fully editable.

### New actions

| Action | Method | Notes |
|---|---|---|
| `list-canvases` | GET | Returns system templates + caller's canvases |
| `create-canvas` | POST | Creates canvas from template slug, copies nodes |
| `rename-canvas` | POST | Updates `name` on a user-owned canvas |
| `delete-canvas` | POST | Deletes canvas + all its nodes/edges (user-owned only) |

---

## 2. Extension Canvas Picker

### UX

A **Canvas** dropdown appears in the extension panel above the "Draft note" button. It lists all user-owned canvases (system templates excluded — they can't be used for drafting directly, only copied from).

- Default: last-used canvas, persisted in `chrome.storage.local` under key `lastCanvasId`
- Falls back to first canvas in the list if no prior selection
- Dropdown label shows canvas name only
- Selection persists across extension opens

### Draft flow change

The selected `canvas_id` is included in the POST body sent to `capture-profile`. The agent scopes its ICP/messaging context to that canvas's nodes (tone, phrase rules, value props, company research, etc.) when drafting the connection note.

The extension calls `list-canvases` (already needed for the web app) filtered to `is_system = 0`.

---

## 3. Company Node

### Node type

New `NodeKind` value: `"company"`. Uses existing `messagingNodes` table columns — no new columns needed:
- `title` — company name (the user-typed trigger field)
- `notes` — auto-fetched research summary written back by the agent

### Auto-research flow

1. User adds a Company node to the canvas and types a company name into the title field
2. On blur, if the title is non-empty and has changed since last research, the node enters a loading state ("Researching…")
3. App sends a `sendToAgentChat` message instructing the agent to search the web for company context: industry, size, recent news, key initiatives, GTM motion, inferred buyer pain points
4. Agent writes the summary back to the node via `update-messaging-node`
5. Node renders the summary in a read-only section below the title

A **Refresh** button lets the user manually re-trigger research (useful after the company has news or the user corrects the name).

### Drafting integration

When a canvas containing a Company node is used for extension drafting, the company research summary is injected into the agent's context alongside tone, phrase rules, and persona information.

---

## 4. Message Preview Panel

### UX

A **"Preview message"** button in the canvas toolbar (alongside existing controls) opens a slide-out sheet on the right side of the canvas.

### Behavior

1. Agent takes all nodes on the current canvas as context
2. Generates a sample connection note as if drafting for a fictional but realistic prospect (generic VP/Director at a mid-size SaaS company — not a real captured prospect)
3. Note renders in the sheet with a **Copy** button
4. A **Regenerate** button produces a fresh sample without closing the panel

The preview is a dry-run sanity check — useful for validating tone and phrase rules before using the canvas in the extension.

### Implementation

Sends a `sendToAgentChat` call with the canvas nodes as context and a prompt instructing the agent to draft for a fictional prospect. Result streams into the sheet.

---

## 5. Right-Click AI Node Menu

### UX

Right-clicking any node on the canvas opens a contextual menu anchored near the cursor with AI actions relevant to that node type.

### Actions

| Action | Behavior |
|---|---|
| **Create variations** | Generates 2–3 alternative versions of the node, placed as new nodes adjacent to the original for side-by-side comparison |
| **Generate content** | Fills the node's empty fields using AI, based on canvas context |
| **Rewrite** | Rewrites existing node content from a different angle, same structure |
| _(divider)_ | |
| **Delete node** | Deletes the node (same as hover X or keyboard shortcut) |

### Loading states

Selecting an action shows a "Generating…" indicator on the node. Variations appear as new nodes offset to the right with a subtle "Variant" label. Variants are regular nodes — the user can keep, edit, connect, or delete them like any other node.

### Implementation

Each AI action sends a `sendToAgentChat` call with the node's current content + canvas context. Results are written back via `create-messaging-node` (for variations) or `update-messaging-node` (for rewrite/generate).

---

## 6. Delete Node UX

Three ways to delete a node — all use the existing `delete-messaging-node` action:

1. **Hover X button** — hovering a node reveals a small X in the top-right corner; one click deletes immediately
2. **Right-click menu** — "Delete node" at the bottom of the contextual AI menu (section 5)
3. **Keyboard shortcut** — select a node, press `Backspace` or `Delete`

No confirmation dialog for node deletion (low stakes, easy to re-add). The edit sheet's existing delete button remains as a fourth path for users who discover it that way.

---

## Data model summary

### New table

```
messaging_canvases (id, name, template_slug, is_system, owner_email, created_at, updated_at)
```

### Modified tables

```
messaging_nodes   — add: canvas_id text
messaging_edges   — add: canvas_id text
```

### New actions

```
list-canvases       GET   publicAgent (used by both web app and extension via apiToken)
create-canvas       POST  auth
rename-canvas       POST  auth
delete-canvas       POST  auth
```

### Modified actions

```
capture-profile     POST  accepts canvas_id in body
get-messaging-graph GET   filters by canvas_id
create-messaging-node POST  requires canvas_id
create-messaging-edge POST  requires canvas_id
```

---

## Out of scope (deferred to Spec 2)

- Prospect page follow-up highlighting and overdue tracking
- LinkedIn redirect bug fix on bad-fit prospects
- Live canvas collaboration (dropped entirely)
- Account research hub with visualizations
