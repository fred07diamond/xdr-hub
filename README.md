# XDR Hub — AI Agent Platform

XDR Hub is a unified AI agent platform for Builder.io's XDR team. It bundles three purpose-built apps — a LinkedIn outreach cockpit, a meeting booking agent, and a workspace dispatch layer — into a single monorepo deployed at [xdr-hub.netlify.app](https://xdr-hub.netlify.app).

---

## Apps

### LinkedIn Agent — `/li-agent`

A full-stack AI outreach cockpit for LinkedIn prospecting.

- **Prospect pipeline**: captures LinkedIn profiles via the Chrome extension, scores each against your ICP, and drafts personalized connection notes
- **ICP management**: define multiple personas; prospects are matched and tagged at capture time
- **Queue**: tracks outreach status (captured → drafted → sent) across the team
- **HubSpot integration**: links prospects to HubSpot contacts and deals
- **Messaging canvas**: node-based messaging workflow builder
- **Post Engagement scraper**: surfaces commenters from LinkedIn posts as warm prospects
- **Chrome extension** (Builder.LI): Manifest V3 side panel extension; reads LinkedIn profiles and post commenters, displays scored drafts, marks sends

### XDR Booking Agent — `/booking`

An AI agent for managing meeting bookings and post-meeting workflows.

- Captures and tracks booked meetings
- Generates meeting notes and CRM updates
- Integrates with Google Calendar for availability

### XDR Hub Dispatch — `/dispatch`

The workspace hub and orchestration layer. Manages cross-app navigation, shared authentication, vault keys, and workspace resources. All team members log in through Dispatch.

---

## Repository Layout

```
xdr-hub/
├── packages/
│   └── shared/               # @xdr-hub/shared — cross-app code and skills
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
- `localhost:3000/dispatch` — Dispatch hub
- `localhost:3000/li-agent` — LinkedIn Agent
- `localhost:3000/booking` — Booking Agent

Auth is restricted to `@builder.io` Google accounts.

---

## Deployment

Deployed as a Netlify workspace to **[xdr-hub.netlify.app](https://xdr-hub.netlify.app)**.

Required Netlify environment variables:

| Variable | Purpose |
|---|---|
| `BETTER_AUTH_URL` | `https://xdr-hub.netlify.app` |
| `BETTER_AUTH_SECRET` | Shared auth secret (same across all apps) |
| `DATABASE_URL` | Primary Neon PostgreSQL connection (pooled) |
| `BOOKING_DATABASE_URL` | Booking app Neon connection (pooled) |
| `BOOKING_DATABASE_URL_UNPOOLED` | Booking app Neon connection (direct, for migrations) |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | Google OAuth |
| `GOOGLE_SIGN_IN_CLIENT_ID` / `GOOGLE_SIGN_IN_CLIENT_SECRET` | Google sign-in |
| `WORKSPACE_ORG_DOMAIN` | `builder.io` |
| `ANTHROPIC_API_KEY` | LLM provider |

---

## Architecture

### Three-layer inheritance

Every app inherits behavior automatically — no opt-in config needed:

1. **App local** (highest priority) — `apps/<name>/server/plugins/`, `apps/<name>/actions/`, `apps/<name>/AGENTS.md`
2. **Workspace shared** (middle) — `packages/shared/src/`, `packages/shared/AGENTS.md`
3. **Framework** (lowest) — `@agent-native/core` defaults

The workspace root `package.json` links everything via `agent-native.workspaceCore: "@xdr-hub/shared"`.

### Auth

Single sign-on via Google OAuth restricted to `@builder.io` domain. Auth flows through Dispatch (`/_agent-native/auth`); all sub-apps share the session cookie.

### Database

- `DATABASE_URL` — shared Neon PostgreSQL (li-agent tables + dispatch)
- `BOOKING_DATABASE_URL` — separate Neon database for the booking app

---

## Chrome Extension

The **Builder.LI** extension is distributed via the [Chrome Web Store](https://chrome.google.com/webstore). Source lives at `apps/li-agent/extension/`.

To publish a new version:
1. Update `manifest.json` version
2. Zip the extension directory: `zip -r builder-li-<version>.zip apps/li-agent/extension/`
3. Upload to Chrome Web Store Developer Dashboard

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
