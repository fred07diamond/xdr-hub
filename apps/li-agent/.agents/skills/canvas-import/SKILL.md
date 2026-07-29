---
name: canvas-import
description: Use when a user shares a document (PDF, Word doc, text file) and wants canvas nodes extracted from it. Reads the file natively and calls create-canvas-nodes to build the messaging canvas as a proper tree.
---

# Canvas import from document

## When to use
Use this skill when the user shares a file attachment and asks to "import", "extract nodes", "build my canvas from this", or similar. Do NOT use for ICP documents — those go to save-icp-document.

Every import is independent. Never refuse or skip extraction because the document looks the same as one you recall importing before, or because the canvas already has nodes — always read the attachment fresh and call create-canvas-nodes again. "Already built" is never a valid reason to do nothing; if the user is asking again, they want it done again.

## Step 1: Read the attachment
The user's file is available as an attachment in this turn. Read its full content, completely — not just the first page or the first few names. Extract every named person, role, and fact that has real signal, not just the ones that jump out. A thin extraction that skips people is a failed import.

## Step 2: Determine the target canvas and its existing personas
If the request already states a target canvas ID (e.g. "Target canvas ID: ..." — this is the tab the user currently has open in their browser), use that ID directly. Do not call `list-canvases` and do not second-guess it against "which canvas looks like the real target" — the user's open tab is correct by definition, even if another canvas has more content or a more on-the-nose name.

Only when NO canvas ID is given in the request: call `list-canvases` and pick the most recently updated canvas, or ask the user if several have meaningful names.

Either way, once you have the target `canvasId`, call `get-messaging-graph` with it and read the `nodes` it returns for every node with `type: "persona"` — that is the exact, closed list of personas you are allowed to attach anything to. Write down each persona's `title` and `id` before you extract anything. If `get-messaging-graph` returns zero persona nodes, skip persona-matching entirely for this import (every node you create will fall back to the company anchor — that's expected, not an error).

## Step 3: Build the tree, not a flat list

The canvas should read top-to-bottom as: **Company → Persona → Role → named individual**. Deal-level facts that don't belong to one person (competition, decision criteria, process, metrics, the core pain) hang directly off the Company instead. Building this correctly requires wiring nodes to EACH OTHER, not just to the company — read the rest of this step before extracting anything.

### 3a. Identify the company
Exactly one `company` node per named account. `title` = company name. `notes` = industry, size, initiatives, pain, context — 2 sentences max, only what the doc actually says.

### 3b. Identify every named person and their role — this is the part that was getting skipped
For every named individual in the document who has a title or function attached (not just the two or three most prominent ones — all of them):

1. Note their **title/function** (e.g. "Associate Director, Agentic AI", "CTO", "Chief Innovation Officer").
2. Decide which **existing persona** from your Step 2 list is the closest fit for that title. Always pick the closest one — do not skip persona-matching just because the fit isn't perfect. Only omit `personaName` if genuinely nothing on the list is in the same universe (e.g. an Engineering persona list and a Finance/Legal title).
3. Group people who share the identical title/function under ONE `role` node. `title` = the shared role/title (e.g. "Internal GenAI/Tooling Leaders"). `personaName` = the persona name you picked in step 2 (must match a title from your Step 2 list exactly). Give this node a `ref` (e.g. `"role-genai-leaders"`).
4. For EACH named person under that role, create their own small node — `champion` if they read as an internal advocate, `economic_buyer` if they control budget/signed off, otherwise `champion` as the default for "a specific person worth remembering." `title` = the person's name. `notes` = their specific detail from the doc (what they said, did, or care about) in 1-2 sentences. Set `parentRef` to the role node's `ref` from step 3 — this is what nests them under their role instead of dumping them straight on the company.

Do not collapse multiple named people into one node's `notes` field as a list of names — per-person nodes are what makes the canvas inspectable and editable person-by-person.

### 3c. Deal-level facts (no parentRef, no personaName)
Extract these as their own nodes exactly as before — they attach directly to the company:
- **identify_pain**: a specific, named pain creating outreach urgency. `title` = pain in 4-6 words.
- **economic_buyer**: only use this at the top level (no parentRef) for a budget-holder who ISN'T already captured as a named person under a role in 3b — don't double-create the same person twice.
- **competition**: a competitor or current vendor mentioned.
- **decision_criteria** / **decision_process** / **paper_process** / **metrics**: as before — specific, named, doc-grounded only.

### 3d. Messaging-style nodes (unrelated to the org tree)
`tone`, `phrase_rule`, `example` still work as before — `personaName` when the doc's guidance is persona-specific, omitted when it's universal.

### Worked example
Document says: *"James Zabinski (Associate Director, Agentic AI) and Traci Gusher (Principal, AI Leader) are both pushing internal AI governance. Existing personas on canvas: 'Product Persona', 'Engineering Persona'."*

```json
{
  "canvasId": "...",
  "nodes": [
    { "type": "company", "title": "EY", "notes": "..." },
    {
      "type": "role", "ref": "role-ai-leaders", "title": "AI Governance Leaders",
      "personaName": "Product Persona", "notes": "Pushing internal AI governance adoption."
    },
    {
      "type": "champion", "parentRef": "role-ai-leaders", "title": "James Zabinski",
      "notes": "Associate Director, Agentic AI — advocating for governance internally."
    },
    {
      "type": "champion", "parentRef": "role-ai-leaders", "title": "Traci Gusher",
      "notes": "Principal, AI Leader — pushing the same initiative."
    }
  ]
}
```

## Step 4: Call create-canvas-nodes

One call, nodes listed in **parent-before-child order** (a node's `ref` must appear on a node earlier in the array than any node whose `parentRef` points to it):
- `canvasId`: from Step 2
- `nodes`: your array, following the tree structure from Step 3

The action wires the tree automatically: `parentRef` takes priority, then a matched persona anchor, then the company as a universal fallback — nothing is left disconnected.

## Rules
- Exhaustive, not just headline entities — every named person with a title gets a node. If you're unsure whether someone is worth a node, include them; the user can delete, they can't fix nodes you never created.
- Never fabricate — only use what the document actually says.
- Keep notes to 2 sentences max — concise and actionable.
- Always create the company node first if any named account appears.
- Never invent a persona name that isn't in your Step 2 list.

## Step 5: Confirm
Tell the user how many nodes were created, the tree shape (e.g. "3 roles, 9 named people under them, plus 4 deal-level facts on the company"), and which people/facts you left out and why (e.g. rows with no real signal). Offer to attach anyone you skipped if the user points them out.
