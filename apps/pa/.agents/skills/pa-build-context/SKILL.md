---
name: pa-build-context
description: >-
  Build context and guardrails for the PA app. Use before planning or changing
  any code, schema, action, route, or integration in apps/pa.
scope: dev
---

# PA build context

1. Read `docs/OUTLINE.md` for the current milestone and its gate. Work only
   on that milestone.
2. Read `docs/DECISIONS.md`. Do not reverse a decision without recording a
   new one.
3. Read the matching section of `docs/SPEC.md` before writing code.
4. Before using any framework API, search the version-matched docs:
   `pnpm action docs-search --query "<topic>"`, then confirm the shape in the
   installed `.d.ts` files.
5. Before using any other external API or package, read its official docs
   and add a row to `docs/SOURCES.md`, with the link in a comment at the call
   site.

## Guardrails

- No inline model calls in UI or server code. Agent steps run through the
  framework's agent, with narrow tools and typed save actions.
- No sends and no CRM writes before M2. After that, only through
  `needsApproval` actions and the outbox with idempotency keys.
- Inbound routes verify signatures from the raw body and fail closed.
- The webhook handler never runs agent work. Enqueue, return 200, and
  process in the signed processor.
- One writer per field: only the scorecard step writes scorecards.
- Every external call goes through `server/core/gateway`. For HubSpot the
  gateway wraps the shared `hubspotFetchWithTimeout`; never add a second
  HubSpot client or token (D35).
- PA's rules come from `docs/`. Do not import code, enums, or thresholds from
  `apps/lead-triage` (D37); lift a generic helper into `packages/shared`
  instead.
- The workspace pins core 0.176.4. Verify every framework API against that
  version, never a newer one (D33).
- Tables use the `pa_` prefix. Migrations are additive, through
  `runMigrations` with `{ table: "pa_migrations" }` (D28), on portable
  `@agent-native/core/db/schema` helpers, never `pg-core` (D40).
- Untrusted text is escaped in Slack and the UI, and never becomes a link or
  mention.
- The playbook is data (D44). A new rule needs a param schema in
  `resolve.ts`, its rule function, an `EVALUATORS` entry in
  `capabilities.ts` with the CRM fields it reads, and tests; until then it
  publishes as not enforced. Never make code read a playbook value the
  manifest does not list.
- Every migration goes in `PA_MIGRATIONS` in `server/plugins/db.ts`; the
  integration tests apply that list, so an unregistered migration fails.
- No em dashes or en dashes in copy, drafts, or docs.

## Definition of done

The four areas are covered (UI, action, skill or `AGENTS.md`, app-state).
Unit, contract, and eval tests pass. Typecheck and `agent-native doctor` are
clean. `OUTLINE.md`, `DECISIONS.md`, `SOURCES.md`, and `CHANGELOG.md` are
updated.
