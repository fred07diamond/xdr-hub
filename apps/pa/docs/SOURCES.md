# Sources

## The rule

Before adding a dependency or calling any external API:

1. Open its official documentation. For Agent-Native, use the version-matched
   docs and types in `node_modules/@agent-native/core/`.
2. Add a row below with the URL or doc slug, the version, and the date.
3. Link the section in a comment at the call site.

A search result or memory is not enough. If the docs contradict this file,
the docs win, and this file gets updated.

## Consulted while writing this kit (2026-09-29)

### Agent-Native (`@agent-native/core` 0.197.0, package docs and source)

The workspace runs 0.176.4 (D33). Rows below were read on 0.197.0; re-read
each on 0.176.4 before relying on it.

Re-checked on 0.176.4 (2026-09-29): `dist/server/index.d.ts` (no
`registerRecurringSweepHandler`; `runAgentLoop` present),
`dist/deploy/workspace-deploy.js` (per-app recurring-jobs trigger; per-app
`netlify.toml` ignored), `dist/integrations/plugin.js` (Slack interactions
scope), `docs/content` (slugs present).

| Doc or file                                                      | Used for                                                                                         |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `docs/AGENTS.md` (package)                                       | Version-matched lookup: `docs-search`, `framework-search`, `source-search`; "do not invent APIs" |
| `key-concepts`                                                   | Five rules, the four-area checklist, `defineAction`, the agent chat bridge, live sync            |
| `multi-app-workspace`                                            | Workspace shape, `add-app`, shared `DATABASE_URL`, `packages/shared`                             |
| `server-routes`                                                  | Custom Nitro routes for raw-body webhooks                                                        |
| `integration-webhooks` skill (shared skills in the xDR Hub copy) | SQL queue, 200, self-fired processor, retry sweep. Not shipped in 0.197.0 (D19)                  |
| `automations`, `recurring-jobs`                                  | Event automations, run-as-creator, scheduler caveats on serverless                               |
| `durable-background-runs`, `netlify`                             | Background function budget, Netlify preset, keep-warm                                            |
| `dist/jobs/sweep-hooks.d.ts`, `dist/server/index.d.ts`           | `registerRecurringSweepHandler` export and its 90 second budget                                  |
| `dist/deploy/build.js`                                           | Netlify per-minute scheduled trigger for the recurring sweep                                     |
| `dist/integrations/plugin.js`                                    | Slack interactions route scope (framework approval controls only)                                |
| `agent-surfaces`, `processors`                                   | `runAgentLoop` for server-side orchestration; processors and `TripWire`                          |
| `actions-access-control`                                         | `needsApproval`                                                                                  |
| `actions-run-context`                                            | `ctx` identity and caller                                                                        |
| `actions-advanced`                                               | `defineFeatureFlag`, rules, percentage rollout                                                   |
| `integrations`, `workspace-connections`                          | Provider API runtime, vault, `credentialRef`, HubSpot, Slack, Gmail connections                  |
| `messaging`, `messaging-internals`                               | Built-in Slack adapter setup and proactive sends                                                 |
| `server-database`, `neon`                                        | Drizzle, PGlite, `runMigrations`, pooled and unpooled URLs                                       |
| `evals`, `observability`                                         | CI eval gate, scorers, promoting traces                                                          |
| `audit-log`                                                      | Audit targets on actions                                                                         |
| `security`                                                       | Inbound webhook verification, secrets, SSRF                                                      |
| `skills-guide`, `writing-agent-instructions`                     | Skill scopes, small `AGENTS.md`, the `CLAUDE.md` symlink                                         |
| `template-mail-developers`                                       | `send-email` with `needsApproval`, Gmail OAuth, draft queue                                      |
| `versioning-and-stability`                                       | Pre-1.0 policy, codemods, upgrades                                                               |
| CLI `create --help`                                              | `create [name] --template`, `--standalone`, `--headless`                                         |
| Plugin skill `turn-into-app`                                     | Scaffold commands, `agent-native.json`, `AUTH_DISABLED`, UI contract                             |

## Consulted during the first build pass (2026-09-29 and 2026-09-30, on 0.197.0)

### Agent-Native (`@agent-native/core` 0.197.0 installed docs, types, and source)

| Doc or file                                                                                   | Used for                                                                           |
| --------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `template-chat-first-edits`, generated `AGENTS.md`, `DESIGN.md`, `DEVELOPING.md`              | What to replace in the chat template; the UI contract                              |
| `environment-variables`, `dist/server/auth.js`                                                | `AUTH_DISABLED=1` for local preview; the role of `A2A_SECRET`                      |
| `agent-native-config`                                                                         | `onboarding.firstRun` and `doctor` keys in `agent-native.json` (D27)               |
| `dist/cli/workspace-dev.js`                                                                   | `WORKSPACE_DEFAULT_APP`, `WORKSPACE_NO_OPEN`, gateway port                         |
| `dist/workspace-app-config.js`, `defineAppConfig`                                             | `homePath: "/inbound"` and the PA Hub brand name                                   |
| `dist/org/workspace-app-access.js`, `dist/server/auth.js`                                     | Why local gateway calls failed closed, and the local-dev patch (D29, D32)          |
| `multi-app-workspace` (shared env)                                                            | Without a shared `DATABASE_URL`, local apps share no users or orgs (D32)           |
| `dist/vite/client.js` (`getAgentKitOptimizeDeps`)                                             | Dependency discovery is off; unlisted core entries load unbundled (D29, D32)       |
| `server-database`, `dist/db/migrations.d.ts`, `dist/db/index.d.ts`                            | `runMigrations` with `{ table }` (D28), `createGetDb`, Drizzle pg-core tables      |
| `doctor`, `dist/guards/*`                                                                     | Guards run by `agent-native doctor`                                                |
| `security` (data scoping)                                                                     | Why PA sets `frameworkTools.database: "off"` and reads only through actions        |
| `actions-agent-tools`, `dist/server/action-discovery.js`                                      | `frameworkTools`; files in `scripts/` become actions unless prefixed with `_`      |
| `actions-access-control`, `actions-run-context`, `dist/action.d.ts`                           | `defineAction`, `readOnly`, `http`, `fail()`, `ctx.caller` values                  |
| `client-data`, `dist/client/use-action.d.ts`, `dist/client/use-db-sync.d.ts`                  | `useActionQuery`, `useActionMutation`, `useDbSync` with a realtime reason          |
| `context-awareness`, `dist/client/application-state.js`, `dist/application-state/handlers.js` | `navigation` and `selection` app state, tab-scoped keys, `view-screen`             |
| `dist/client/agent-chat/index.d.ts`, `dist/client/dynamic-suggestions.js`                     | `AgentSidebar`, `sendToAgentChat`, `dynamicSuggestions.getSuggestions`             |
| `dist/vite/client.js`                                                                         | `optimizeDeps` defaults behind the agent panel crash fix (D29)                     |
| `evals`, `dist/eval/*.d.ts`, `dist/eval/runner.js`                                            | `defineEval`, `createScorer`, `usesTool`, `llmJudge`, `skipReason`, `runEvalSuite` |
| `@agent-native/toolkit` 0.23.1 `dist/ui/*`                                                    | Button, Sheet, Checkbox, and dropdown primitives and their variants                |

### Packages added

| Package       | Version                         | Source                                                                    | Used for                                                  |
| ------------- | ------------------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------- |
| `yaml`        | ^2.9.0                          | https://eemeli.org/yaml/                                                  | Parsing playbook and config YAML at build time only (D24) |
| `drizzle-orm` | ^0.45.2 (matches the framework) | https://orm.drizzle.team/docs/column-types/pg, /docs/select, /docs/insert | Typed `pa_` tables and the repository                     |

Other references: the ULID spec (https://github.com/ulid/spec) for ids, and
ECMA-402 `Intl.DateTimeFormat` for working-hours and time-zone math.

### HubSpot

| Source                                                                                                   | Used for                                                                                             |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/request-validation | v3 signature: HMAC SHA-256 of method + URI + body + timestamp, base64, 5 minute window               |
| https://developers.hubspot.com/docs/guides/apps/authentication/validating-requests                       | v1 and v2 signatures; v2 is used by workflow webhook actions                                         |
| https://knowledge.hubspot.com/workflows/how-do-i-use-webhooks-with-hubspot-workflows                     | "Send a webhook" action, Data Hub Professional or Enterprise, request-signature auth with the app id |
| https://developers.hubspot.com/docs/api/crm/email                                                        | Email engagement create: required `hs_timestamp`, direction, status, associations                    |

### Slack

| Source                                                               | Used for                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------------- |
| https://docs.slack.dev/authentication/verifying-requests-from-slack/ | v0 signature over `v0:timestamp:body`, 5 minute window            |
| https://docs.slack.dev/interactivity/handling-user-interaction/      | 200 within 3 seconds; `response_url` usable 5 times in 30 minutes |

### Netlify

| Source                                                        | Used for                                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| https://docs.netlify.com/build/functions/scheduled-functions/ | Fallback scheduler: 30 second limit, published deploys only, UTC cron         |
| https://docs.netlify.com/build/functions/configuration        | Default execution limits for synchronous, scheduled, and background functions |

### Claude (through the framework engine)

| Source                                                       | Used for                                                               |
| ------------------------------------------------------------ | ---------------------------------------------------------------------- |
| https://platform.claude.com/docs/en/models                   | Current model lineup and IDs                                           |
| https://platform.claude.com/docs/en/models/sonnet-5/overview | Some current models reject non-default `temperature`, `top_p`, `top_k` |

### Claude Code

| Source                                     | Used for                                                   |
| ------------------------------------------ | ---------------------------------------------------------- |
| https://code.claude.com/docs/en/sub-agents | Subagent definitions and frontmatter fields, if we add any |

### Product context

| Source                                                                             | Used for                                                             |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| https://www.builder.io/m/partners/apply                                            | Agency partner program: revenue share, technical resources, training |
| HBR, "The Short Life of Online Sales Leads" (2011), via its widely quoted findings | Contact within an hour: nearly 7 times as likely to qualify          |

## Must consult before use (not yet read closely)

- HubSpot: contacts, companies, deals, owners, and properties APIs; form
  submissions API (backstop poll); rate-limit headers and current limits;
  required scopes for email engagements; the app model for the workflow
  webhook's client secret.
- Slack: `chat.postMessage`, `chat.update`, `conversations.open`,
  `users.lookupByEmail`, Block Kit reference, rate limits, app manifest, and
  export format or `conversations.history` for the baseline.
- Gmail: sending through the framework's Mail plumbing; Google OAuth consent
  for an internal app.
- Node: `dns.promises.resolveMx`, if the email deliverability check uses MX
  lookups.
- Any npm package not already in the scaffold.

## Consulted during the xDR Hub merge (2026-09-29, on 0.176.4)

| Doc or file                                               | Used for                                                                                        |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `dist/db/schema.js`                                       | Portable `table`, `text`, `integer` (boolean mode), `real`; no JSON mode on Postgres text (D40) |
| `dist/db/client.js`                                       | `file:` and `pglite:` URLs for the dialect tests (D40)                                          |
| `dist/server/agent-chat/plugin-options.d.ts`              | `frameworkTools`, `initialToolNames` (D38)                                                      |
| `dist/action.d.ts`                                        | `ActionRunContext.runId`; no per-call tool id (D40)                                             |
| `dist/server/auth.js`, `dist/org/workspace-app-access.js` | The local app-access gate (D32 note)                                                            |
| `packages/shared/src/server/roles.ts`                     | `getWorkspaceRole` for admin rights (D35)                                                       |

### Packages added

| Package                | Version           | Source                   | Used for                                                  |
| ---------------------- | ----------------- | ------------------------ | --------------------------------------------------------- |
| `@electric-sql/pglite` | ^0.5.8 (dev only) | https://pglite.dev/docs/ | Running the repository tests on Postgres in process (D40) |

## The xDR Playbook (Notion, read 2026-09-29)

The team's own description of the sales process. Where it conflicts with the
kit, D43 records the conflict; the playbook entries change only through a
confirmed release.

| Page                                                                                  | Last edited | Used for                                                                                                                                  |
| ------------------------------------------------------------------------------------- | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [1 Overview](https://app.notion.com/p/3123d7274be581069019e182a7ddc09b)               | 2026-08-26  | Team structure, segments, Enterprise and Commercial routing, owner fields, AE round robins, agency paths, excluded countries, terminology |
| [2 Quick Reference](https://app.notion.com/p/3123d7274be5810ba3b6e030a1f591a8)        | 2026-08-26  | Automated Contact Sales flow, daily queue order, SLAs, thresholds                                                                         |
| [3 Shared Workflows](https://app.notion.com/p/3123d7274be58188bb74c71c3a46b4aa)       | 2026-08-26  | Sequence library and enrollment rules, handoff, PG Tuesday, dispositions                                                                  |
| [4 Inbound](https://app.notion.com/p/3123d7274be581169005daee8a09c3d8)                | 2026-08-14  | Dobby's SAL and Recycle decisions, the xDR's monitoring role, Content versus Code bars, agency routing, CMS trial snippets                |
| [7 Glossary and Reference](https://app.notion.com/p/3123d7274be581b5aaa1c18b8b8885e8) | 2026-08-14  | QL, SAL, S0, S1, handraiser, recycled and disqualified leads                                                                              |

Not read yet, and linked from these pages: the xDR Qualification Decision
Trees, Tooling (Claude projects, Nooks lists), the Round Robin spreadsheet,
and Section 9 (Outbound Playbook).

## Consulted for the dynamic playbook (2026-09-30, on 0.176.4)

| Doc or file                                                                  | Used for                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `dist/org/app-roles.d.ts`, `dist/client/org/TeamPage.d.ts`                   | `defineAppRoles`, `resolveAppRole`, `listAppMemberRoles`; `TeamPage appRoles` (D44)               |
| `dist/notifications/*.d.ts`, `notifications` doc                             | `notify`, `registerNotificationChannel`, `NotificationsBell` (D44, D45)                           |
| `dist/event-bus/*.d.ts`                                                      | In-process, not durable on serverless: not used for handoffs (D44)                                |
| `dist/automations/service.d.ts`, `dist/jobs/run-now.d.ts`, `automations` doc | `defineAutomation`, `listAutomationDefinitions`, `queueAutomationRunNow`; jobs need `appId` (D44) |
| `dist/action.d.ts`                                                           | `agentTool: false`, `ActionCaller` values (D44)                                                   |
| `dist/secrets`, li-agent `register-secrets.ts`                               | `registerRequiredSecret`, `readAppSecret` for the Slack token (D45)                               |
| `dist/db/migrations.js`                                                      | Why the Postgres test applies the registered list (the runner closes its DDL connection)          |

### Slack

| Source                                                       | Used for                    |
| ------------------------------------------------------------ | --------------------------- |
| https://docs.slack.dev/reference/methods/users.lookupByEmail | Finding the recipient (D45) |
| https://docs.slack.dev/reference/methods/conversations.open  | Opening the DM              |
| https://docs.slack.dev/reference/methods/chat.postMessage    | Sending, with unfurls off   |

## Consulted for the block builder and CRM work (2026-09-30)

| Doc or file                                                                | Used for                                                                                  |
| -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `dist/client/blocks/types.d.ts`, `server.d.ts`, `SchemaBlockEditor.d.ts`   | Core's block contract (MDX-bound) and the schema-driven editor used as the fallback (D46) |
| corpus `templates/tasks/app/components/dnd/*`, `analytics` droppable areas | Sortable lists and palette-to-area drops (D46)                                            |
| `dist/secrets/index.d.ts`, `storage.d.ts`, `routes.js`                     | `writeAppSecret`, `getAppSecretMeta`, `deleteAppSecret`, scopes, encryption (D47)         |
| `@agent-native/dispatch` 0.33.1 `vault-store.js`                           | Why PA writes the encrypted org slot directly (D47)                                       |
| `dist/workspace-connections/store.d.ts`, `dist/connections/catalog.js`     | `listWorkspaceConnectionsForApp`; HubSpot and Salesforce OAuth (D47)                      |

### Packages added

| Package                                                    | Version              | Source                   | Used for                           |
| ---------------------------------------------------------- | -------------------- | ------------------------ | ---------------------------------- |
| `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` | 6.3.1, 10.0.0, 3.2.2 | https://docs.dndkit.com/ | Palette drops and reordering (D46) |

### HubSpot

| Source                                                                             | Used for                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| https://developers.hubspot.com/docs/api/crm/properties                             | Property definitions for mapping (D48)                                                                                                                                                                                                                                                                                              |
| https://developers.hubspot.com/docs/api/crm/owners                                 | The read-only token test (D47)                                                                                                                                                                                                                                                                                                      |
| https://developers.hubspot.com/docs/api/private-apps                               | Private app tokens and scopes (D47)                                                                                                                                                                                                                                                                                                 |
| https://developers.hubspot.com/docs/api/crm/search                                 | Contact Sales intake and contact lookup by email (D54)                                                                                                                                                                                                                                                                              |
| https://developers.hubspot.com/docs/api/crm/associations                           | Contact to company and company to deal reads, v4 (D54)                                                                                                                                                                                                                                                                              |
| HubSpot portal property definitions, read with the HubSpot connector on 2026-09-30 | `lifecyclestage` options (RAW, MEL, QL, SAL, S0, S1, Closed, Recycle, Excluded, Disqualified), `message`, `what_is_your_use_case__contact_sales_`, `current_tech_stack__contact_sales_questionnaire_`, `budget_status_for_dev_tools_this_year_`, `what_is_your_company_size_`, `most_recently_contact_sales_date__date_time_` (D54) |

### Framework (D54)

| Source                                                                                 | Used for                                                                                                                       |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `docs/content/automations.mdx`, `dist/jobs/run-now.d.ts`                               | The inbound agent: a scheduled organization automation that runs as its creator; `queueAutomationRunNow` wakes it after a pull |
| `docs/content/durable-background-runs.mdx`                                             | Agent runs on Netlify background functions                                                                                     |
| Sales handbook `03-lead-routing-and-playbooks`, `05-email-playbook` (PA database, D53) | The message rule and draft lint (D55)                                                                                          |
