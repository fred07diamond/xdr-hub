---
name: canvas-import
description: Use when a user shares a document (PDF, Word doc, text file) and wants canvas nodes extracted from it. Reads the file natively and calls create-canvas-nodes to build the messaging canvas.
---

# Canvas import from document

## When to use
Use this skill when the user shares a file attachment and asks to "import", "extract nodes", "build my canvas from this", or similar. Do NOT use for ICP documents — those go to save-icp-document.

## Step 1: Read the attachment
The user's file is available as an attachment in this turn. Read its full content. Do not ask for a text paste — you have the file directly.

## Step 2: Determine the target canvas
Call list-canvases to see the user's canvases. Use the most recently updated one, or ask the user which canvas to target if there are several with meaningful names.

## Step 3: Extract entities and build nodes

Read the document and extract outreach intelligence. For each entity that has real, specific signal, create a node object. Only create a node if the document gives you enough to fill it usefully.

NODE TYPES — when to create each:

- **company**: A named company. title=company name. notes=industry, size, initiatives, pain, context from the doc. Create one per named account — this anchors all other entity nodes.
- **identify_pain**: A specific, named pain point that creates outreach urgency. title=pain in 4–6 words. notes=the pain + why it matters in cold outreach.
- **champion**: A named person or specific role who'd advocate for you internally. title=person or role name. notes=position, what they care about, how to open with them.
- **economic_buyer**: The person or role who controls budget. title=name or role. notes=what they care about, how decisions are framed.
- **competition**: A competitor or current vendor mentioned. title=competitor name. notes=their relationship to the account, differentiation angles.
- **decision_criteria**: Specific evaluation criteria (not generic "ROI"). title=short label. notes=the criteria in detail.
- **decision_process**: Real intel on approval steps or committees. title=short label. notes=the process.
- **paper_process**: Compliance, procurement, or security requirements. title=short label. notes=what's required.
- **metrics**: Named KPIs or success metrics. title=metric name. notes=context and what success looks like.
- **role**: Messaging guidance for a job function. title=role title. notes=what they care about. phrasesToUse=language that lands. phrasesToAvoid=language that turns them off.
- **tone**: Communication style guidance. title=short label. tone=the voice. valueProps=key value propositions.
- **phrase_rule**: Language dos/don'ts. title=short label. phrasesToUse=exact phrases. phrasesToAvoid=exact phrases to avoid.
- **example**: Sample outreach copy from the doc. title=short label. exampleNotes=the example text.

Rules:
- Quality over quantity. Only create a node when the doc gives specific, actionable signal.
- Never fabricate — only use what the document actually says.
- Keep notes to 2 sentences max — concise and actionable.
- If any named account appears, always create a company node first.

## Step 4: Call create-canvas-nodes

Call create-canvas-nodes with:
- canvasId: the canvas ID from Step 2
- nodes: your array of extracted node objects

The action handles layout and wiring automatically.

## Step 5: Confirm

Tell the user how many nodes were created and which types. Offer to refine any node or add more.
