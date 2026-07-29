# XDR Hub: AI Agent Platform

XDR Hub is a unified AI agent platform for Builder.io's XDR team. It bundles three purpose-built apps, a LinkedIn outreach cockpit, a meeting booking agent, and a workspace dispatch layer, into a single monorepo deployed at [xdr-hub.netlify.app](https://xdr-hub.netlify.app).

---

## Apps

### LinkedIn Agent (Builder.LI) at `/li-agent`

A full-stack AI outreach cockpit for LinkedIn prospecting.

- **Prospect pipeline**: captures LinkedIn profiles via the Chrome extension, scores each against your ICP, and drafts personalized connection notes. Status moves through captured, drafted, and sent.
- **ICP personas**: define multiple named personas, each with its own uploaded ICP document; new prospects are auto-matched to the closest persona at capture time.
- **Messaging canvas**: a tree-structured node graph per account (company, persona, role, named individual) plus MEDDPICC qualification nodes (economic buyer, champion, metrics, decision criteria, and more), tone and phrase rules, and a HubSpot Reference node that pulls real past email correspondence and summarizes what worked. Build a canvas by hand, with an AI prompt, or by importing a document; long imports and AI builds run in the background so they don't block the UI.
- **HubSpot integration**: links prospects to HubSpot contacts and deals, imports a HubSpot list as a trackable outreach queue, and checks ownership before anyone works an account someone else already owns.
- **Post Engagement scraper**: surfaces commenters from LinkedIn posts as warm prospects, with the same HubSpot ownership check and ICP scoring as a normal capture.
- **Analytics**: workspace-wide pipeline stats (fit distribution, send rate, week-over-week trend, per-user activity) for admins.
- **Chrome extension** (Builder.LI): a Manifest V3 side panel extension that reads LinkedIn profiles and post commenters, displays scored drafts, and marks sends. Published on the [Chrome Web Store](https://chromewebstore.google.com/detail/builderli/pnfejojajcalkmlaclnpklgijajjeoak), and linked from the Settings page inside the app.

### XDR Booking Agent at `/booking`

An AI agent for managing meeting bookings and post-meeting workflows.

- Captures and tracks booked meetings, with the AE (not the XDR) set as the calendar organizer and Zoom host so Gong can read the call correctly.
- Creates real Google Calendar events and Zoom meetings automatically, per user OAuth connection.
- Generates meeting notes and CRM updates, and creates HubSpot deals on confirmation.
- Ingests Nooks call-logging webhooks (signature-verified) for teams using Nooks for dialing.

### XDR Hub Dispatch at `/dispatch`

The workspace hub and orchestration layer. Manages cross-app navigation, shared authentication, vault-backed secrets, and workspace resources. All team members log in through Dispatch, which also owns the shared workspace role model (xdr, ae, admin, or no access) and per-app access grants that the other two apps read from.

---

## Repository Layout

```
xdr-hub/
├── packages/
│   └── shared/               # @xdr-hub/shared: cross-app code and skills
│       ├── src/server/       # Shared server plugins
│       ├── src/client/       # Shared React components
│       └── AGENTS.md         # Workspace-wide agent instructions
├── apps/
│   ├── dispatch/             # XDR Hub Dispatch (workspace hub)
│   ├── li-agent/             # LinkedIn Agent
│   │   └── extension/        # Builder.LI Chrome extension (MV3)
│   └── booking/              # XDR Booking Agent
├── netlify.toml              # Deploys all apps to xdr-hub.netlify.app
└── package.json              # Workspace root (pnpm workspaces)
```

---

## Getting Started (Local Dev)

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL, BETTER_AUTH_SECRET, ANTHROPIC_API_KEY
pnpm dev               # starts workspace gateway at localhost:3000
```

Apps are served at:
- `localhost:3000/dispatch`: Dispatch hub
- `localhost:3000/li-agent`: LinkedIn Agent
- `localhost:3000/booking`: Booking Agent

Auth is restricted to `@builder.io` Google accounts.

---

## Deployment

Deployed as a Netlify workspace to **[xdr-hub.netlify.app](https://xdr-hub.netlify.app)**.

Required Netlify environment variables (see `.env.example` for the full, current list):

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_SECRET` | Auth secret, shared across all apps |
| `APP_URL` / `BETTER_AUTH_URL` | Canonical public workspace URL (root origin, not `/dispatch`) |
| `DATABASE_URL` | Shared database connection. Leave blank locally to default to per-app SQLite. |
| `A2A_SECRET` | Shared secret for cross-app A2A calls and integration webhook verification |
| `WORKSPACE_ORG_NAME` / `WORKSPACE_ORG_DOMAIN` / `WORKSPACE_OWNER_EMAIL` | Workspace identity: org name, the allowed login domain, and the initial owner/admin email |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth, used for sign-in and the Calendar integration |
| `ANTHROPIC_API_KEY` | LLM provider for agent chat |

Slack, Notion, Figma, and GitHub connectors, plus Zoom and Nooks credentials for the booking app, are optional and only needed if that integration is in use.

---

## Architecture

### Three-layer inheritance

Every app inherits behavior automatically. No opt-in config needed:

1. **App local** (highest priority): `apps/<name>/server/plugins/`, `apps/<name>/actions/`, `apps/<name>/AGENTS.md`
2. **Workspace shared** (middle): `packages/shared/src/`, `packages/shared/AGENTS.md`
3. **Framework** (lowest): `@agent-native/core` defaults

The workspace root `package.json` links everything via `agent-native.workspaceCore: "@xdr-hub/shared"`.

### Auth and roles

Single sign-on via Google OAuth restricted to the `@builder.io` domain. Auth flows through Dispatch (`/_agent-native/auth`), and all apps share the session cookie. On top of that, a shared workspace role (`xdr`, `ae`, `admin`, or no access) and per-app access grants live in the shared package's tables and are managed from Dispatch's Team & Access page; the workspace owner (`WORKSPACE_OWNER_EMAIL`) always resolves to admin, even before any roles are set.

### Database

SQLite by default for local development (one file per app under `apps/<name>/data/app.db`). Set `DATABASE_URL` to point any app, or the whole workspace, at a persistent SQL database (Postgres, Turso/libSQL, or another supported backend) for production.

---

## Chrome Extension

The **Builder.LI** extension is a Manifest V3 side panel extension, published on the [Chrome Web Store](https://chromewebstore.google.com/detail/builderli/pnfejojajcalkmlaclnpklgijajjeoak). Source lives at `apps/li-agent/extension/`. The li-agent app's Settings page links directly to the store listing so users can find and install it without hunting for the URL.

To publish a new version:
1. Update the `version` in `manifest.json`.
2. Zip the extension directory: `zip -r builder-li-<version>.zip apps/li-agent/extension/`.
3. Upload the new version to the Chrome Web Store Developer Dashboard.

---

## Adding a New App

```bash
pnpm exec agent-native create <app-id> --template=chat
```

Dispatch auto-discovers new apps from `apps/<app-id>/package.json`. No registry to update.

---

## Workspace Maintenance

```bash
pnpm upgrade:agent-native   # bump @agent-native/* deps and refresh skills
pnpm skills:update          # refresh framework skills only (after manual core bump)
pnpm typecheck              # type-check all apps
```
