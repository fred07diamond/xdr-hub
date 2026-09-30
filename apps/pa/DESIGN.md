# Visual Design Contract

PA Hub is a calm operations console for Product Advocates working inbound
Contact Sales leads. The screen answers three questions fast: what did they
ask, who owns it, and how much time is left.

## Product mode

- Mode: `operate`
- Audience and cadence: PAs and their lead, many times a day, scanning a
  queue and opening one record at a time.
- Primary workflow: scan the inbound board, open a lead, read the ask and the
  recommended next step, check why it was routed, and ask the agent.

## Visual direction

- Direction name: Calm operations console
- Palette family: graphite neutrals with a cool undertone. One pine accent,
  used only for the primary action on a screen. Amber means at risk, red
  means breached. Tokens are HSL channels in `app/global.css`, with light and
  dark sets.
- Type treatment: Inter. Tabular numerals only where numbers line up (clocks,
  timestamps). Monospace for ids, entry ids, and release chips.
- Composition: left nav (Inbound, Labels, Ops, Settings) with a footer for
  the Shadow mode pill and short release id. Dense board table on wide
  screens, stacked cards below about 960px of content width. Records use a
  main column (ask, next step, scorecard, draft, timeline) and a side column
  (clocks, pre-check, route, receipts). The framework AgentSidebar sits on
  the right.
- Shape language: 6px corners on controls, 8px on cards, hairline borders,
  flat surfaces, Tabler icons at 1.75 stroke.
- Anti-references: decorative AI sparkles, gradient hero panels, color used
  as decoration, more than one pine button per screen, dead links, and em or
  en dashes in any copy.

## Content rules

- Form text is untrusted. Show it in the locked "From the form" block as
  inert text, highlight flagged phrases, and never turn it into a link.
- Every decision cites playbook entries as chips (`rule.routing.order v1`).
- Unknowns say "Unknown" with the reason, never a guess.
- Placeholders keep the shell and list what the page will do.

## Guardrails

- Preserve the scaffold's semantic tokens and shared component seams.
- Keep domain pages distinct from full-page chat and use the AgentSidebar for
  contextual AI.
- Framework routes (`/settings`, `/team`, `/agent`) keep their own chrome.
