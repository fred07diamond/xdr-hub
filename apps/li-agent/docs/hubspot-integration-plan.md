# Push persona-validated prospects/leads to HubSpot (li-agent)

**Status: not yet built — reference plan for when this is ready to implement.**

## Context

Once a captured LinkedIn prospect or Sales Nav lead gets a persona assigned, the xDR needs a way to get it into HubSpot so the rest of the team can work it there. The app writes to HubSpot in exactly two ways: a "ping" recording that this contact came from this app (when + who pushed it), and the persona classification itself. Both get built into HubSpot list/segment filters on the HubSpot side — the app never manages list membership itself, it only ever sets property values on the contact.

**Confirmed via direct file reads before writing this plan** (not guessed):
- `packages/shared/src/server/hubspot-client.ts` exports `hubspotFetch`/`hubspotFetchIfConnected`/`getHubSpotToken`, already HTTP-method-agnostic — no new client code needed to issue writes.
- No file anywhere in the monorepo currently writes to HubSpot contacts (only `apps/booking/server/helpers/create-hubspot-deal.ts` writes anything at all, to `/crm/v3/objects/deals`).
- `apps/prospecting-hub/server/helpers/hubspot-contact-lookup.ts` searches HubSpot contacts by `email` via `/crm/v3/objects/contacts/search` — best precedent for the dedupe key (li-agent prospects/lead-list-items get an email via Apollo enrichment's `enrichedEmail` column, added earlier this session on both `prospects` and `leadListItems`).
- `server/db/schema.ts`: `prospects` has `fitVerdict`/`fitReason` (strong/possible/weak/inconclusive) AND `personaId`/`personaName`/`personaColor`. `leadListItems` has only the persona fields, no fit verdict at all (shallow import + `selectPersonasBatch` only) — these are genuinely independent axes set at different pipeline stages, not duplicates.
- Current max migration version in `server/plugins/db.ts` is **68** (re-check this before implementing — more migrations may have landed since).

**Decisions locked in with the user:**
1. "Passes persona validation" = has a non-null `personaId`. Applies uniformly to both `prospects` and `leadListItems` (a `leadListItems` row never has a fit verdict, so gating on that would permanently exclude it).
2. Trigger is a manual "Push to HubSpot" button per row, plus a bulk action — mirrors the existing Enrich/"Enrich all" pattern exactly. Never automatic.
3. The app writes to HubSpot in exactly two ways: (a) an import "ping" — two properties recording when it was pushed and by whom, and (b) the assigned persona, as its own property. No HubSpot Lists API involvement at all — no list creation, no membership management. Segmentation happens natively in HubSpot via Active Lists filtered on these properties, built by the user on the HubSpot side (e.g. "Persona = Engineering AND Last Imported from Builder.LI is less than 30 days ago").
4. All three properties are being created directly in HubSpot by the user/CRM team — app code only ever *writes values* to them, never creates the property definitions via the Properties API. **No `crm.schemas.contacts.write` scope needed.**

## Required HubSpot scopes

Only **two**, regardless of the three properties above — writing a value to an existing property is the same operation (`crm.objects.contacts.write`) whether it's one property or five:
- **`crm.objects.contacts.read`** — search for an existing contact by email before deciding create vs. update.
- **`crm.objects.contacts.write`** — create/update the contact and set its properties.

No Lists scopes (nothing calls `/crm/v3/lists/...`). No `crm.schemas.contacts.write` (nothing calls the Properties API — the three property *definitions* already exist in HubSpot, created directly by the user/CRM team; the app only writes values into them).

## What the user needs to do on the HubSpot side

1. Open the HubSpot Private App this workspace uses (Settings → Integrations → Private Apps). Confirm/add the two scopes above, rotate the token, and paste the new token into this app's Settings.
2. Create three custom **Contact** properties in HubSpot (Settings → Properties → Contact properties → Create property), so the internal names match exactly what the code writes:
   - Internal name `li_agent_last_imported_at` — label "Last Imported from Builder.LI" — type **Date picker** (so HubSpot's own list-filter UI supports "more than X days ago").
   - Internal name `li_agent_last_imported_by` — label "Last Imported from Builder.LI By" — type **Single-line text** (stores the xDR's email).
   - Internal name `li_agent_persona` — label "Builder.LI Persona" — type **Single-line text** (stores the persona name, e.g. "Engineering Persona").
   - Adjust "Builder.LI" in the labels if you land on a different product name — doesn't affect the internal names the code uses.
3. Build Active List(s) in HubSpot (Contacts → Lists → Create list → Active) filtering on these three properties in whatever combination is useful — e.g. "Persona = Engineering Persona AND Last Imported from Builder.LI is less than 30 days ago," or per-xDR views using "...By = their email." This is entirely HubSpot-native; nothing in the app needs to know these lists exist.

## Data model changes (`apps/li-agent/server/db/schema.ts`)

Add to both `prospects` and `leadListItems` (mirrors the existing `enrichedAt`-style tracking pattern):
```ts
hubspotContactId: text("hubspot_contact_id"),   // matched/created HubSpot contact id, for idempotent re-push
hubspotPushedAt: text("hubspot_pushed_at"),      // local timestamp of last successful push
```
Migrations in `server/plugins/db.ts`, continuing from the then-current max version: one `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` per column per table, same style as every other migration in this file. (No new column needed for persona itself — `personaName` already exists on both tables; it's just read at push time, not stored again.)

## New server helper: `apps/li-agent/server/helpers/hubspot-push.ts`

```ts
export async function pushContactToHubspot(input: {
  email: string;
  name: string | null;
  company: string | null;
  title: string | null;      // enrichedTitle, falling back to headline
  phone: string | null;      // enrichedPhone
  personaName: string;       // written to HubSpot as its own property
  pushedByEmail: string;     // ctx.userEmail of the xDR triggering the push
}): Promise<{ hubspotContactId: string; contactCreated: boolean }>
```
Logic, built on `hubspotFetch`/`getHubSpotToken` from `@xdr-hub/shared/server` (same import every other li-agent HubSpot action already uses):
1. **Find or create the contact.** `POST /crm/v3/objects/contacts/search` filtering `email` EQ (reusing prospecting-hub's proven search shape).
2. If found: `PATCH /crm/v3/objects/contacts/{id}` setting **only** the three tracking properties (`li_agent_last_imported_at`, `li_agent_last_imported_by`, `li_agent_persona`) — deliberately does NOT overwrite jobtitle/company/phone on an existing contact, since HubSpot is a shared CRM other people actively edit and this push shouldn't clobber their data.
3. If not found: `POST /crm/v3/objects/contacts` creating with `email`, `firstname`/`lastname` (split from `name`), `company`, `jobtitle` (title), `phone`, plus the same three tracking properties — safe to set firmographics here since there's no prior data to lose.
4. Return `{ hubspotContactId, contactCreated }` for the caller to persist locally and show in a toast.

## New actions (mirroring the existing `enrich-prospect.ts`/`enrich-lead-list-item.ts` split by entity type, not one polymorphic action)

**`actions/push-prospect-to-hubspot.ts`** and **`actions/push-lead-list-item-to-hubspot.ts`** — `requiresAuth: true`, `http: { method: "POST" }`, schema `{ id: string }`:
- Same ownership-check shape as `enrich-prospect.ts`/`enrich-lead-list-item.ts`.
- Server-side re-validation of the pass gate (defense in depth, don't just trust the UI): clear error if `personaId`/`personaName` is null ("This lead hasn't been assigned a persona yet"), clear error if `enrichedEmail` is null ("No email on file — enrich with Apollo first").
- `checkRateLimit(ctx.userEmail, "push-to-hubspot", 100)` gate, same convention as the enrich actions.
- Calls `pushContactToHubspot`, then updates the row's `hubspotContactId`/`hubspotPushedAt`, returns `{ ok: true, hubspotContactId, contactCreated }` (or `{ ok: false, error }` on failure — HubSpot write failures surfaced as real text, not swallowed).

## UI changes

Both `app/routes/_index.tsx` (Prospects) and `app/routes/lead-lists.tsx` (Lead Lists) get, mirroring the Enrich button pattern exactly:
- A per-row **"Push to HubSpot"** button in Actions — disabled with a tooltip ("Needs a persona assigned first") when `personaId` is null; disabled with a different tooltip ("Enrich with Apollo to get an email first") when `enrichedEmail` is null; shows "Pushed ✓" once `hubspotPushedAt` is set, with a "Re-push" option to refresh the timestamp/owner/persona.
- A bulk action next to "Enrich selected" / "Enrich all": **"Push eligible to HubSpot"**, filtering the selection/list down to rows that already pass (`personaId` set, `enrichedEmail` set), running sequentially like `handleBulkEnrich`, reporting a progress count and a final "{pushed} pushed, {skipped} skipped (not eligible)" summary — no silent caps.

## AGENTS.md update

Add a short section (matching the existing Apollo-enrichment section's style) documenting: the personaId-based pass gate, that this is manual/button-triggered only, that the push sets exactly three tracking properties on the contact (import timestamp, import owner, persona) and never overwrites firmographics on an existing contact, and that segmentation is entirely HubSpot-native (Active Lists the user builds, not managed by this app).

## Remove the Queue tab (redundant, superseded by Lead Lists)

**Confirmed via direct file reads/greps before writing this section:**
- Queue-specific action files (safe to delete, no other consumers found anywhere in the repo): `actions/delete-queue.ts`, `actions/get-queue-items.ts`, `actions/import-hubspot-queue.ts`, `actions/list-queues.ts`, `actions/update-queue-item.ts`, `actions/list-hubspot-lists.ts` (this last one's only consumer is `queue.tsx`'s "create queue from a HubSpot list" picker).
- `actions/check-hubspot-contact.ts` is **not** Queue-specific — it's also used by `extension/background.js`, `app/routes/_index.tsx` (Prospects), and `actions/enrich-post-engager.ts`. **Do not delete or touch this file.**
- No entries for any Queue action in `server/plugins/auth.ts` or `server/middleware/org-membership.ts`'s public-path allowlists — nothing to clean up there.
- No standalone route-registration file (React Router 7 file-based routing) — deleting `app/routes/queue.tsx` is the whole removal, no separate route config to edit.
- `hubspotQueues`/`hubspotQueueItems` stay defined in `server/db/schema.ts`, unused — consistent with leaving `leadListItems.status` unused earlier rather than risking a destructive migration for a purely cosmetic cleanup with no functional benefit. (These tables notably already have no `CREATE TABLE` migration anywhere in `db.ts` — a pre-existing gap — so there's nothing to remove from migrations either way.)

**Changes:**
1. Delete `app/routes/queue.tsx`.
2. Delete the six action files listed above.
3. `app/components/layout/Sidebar.tsx` — remove the Queue `navItems` entry (`{ icon: IconListCheck, labelKey: "navigation.queue", label: "Queue", href: "/queue", view: "queue" }`).
4. `AGENTS.md` — reword the one incidental "to visit queue item" analogy in the Lead Lists section (it currently compares Lead Lists rows to how "HubSpot Queue items work," which will no longer mean anything once Queue is gone).
5. After deleting the action files, the gitignored `.generated/actions-registry.ts`/`action-types.d.ts` will have stale entries until the next `npm run dev`/build regenerates them; patch the local copy by hand just to get a clean `tsc --noEmit` check, since it's not committed and self-corrects on the next real build.

## Verification plan

1. `npx tsc --noEmit` clean (same baseline-only-errors check used throughout prior work on this app).
2. Confirm all three properties exist in HubSpot and the token has the two scopes before testing (`get-hubspot-connection.ts` should still report connected).
3. Push a real prospect that has both `personaId` and `enrichedEmail` set: confirm a new HubSpot contact is created with the right fields + all three tracking properties; confirm local `hubspotContactId`/`hubspotPushedAt` get set and the UI shows the "Pushed ✓" state.
4. Push a second prospect whose email already matches an existing HubSpot contact: confirm it PATCHes that contact (no duplicate created) and only the three tracking properties change — other fields on that contact stay untouched.
5. Confirm the contact now shows up (or not) in an Active List built per persona/recency filters in HubSpot.
6. Attempt to push a prospect with no persona: confirm the button is disabled client-side, and a direct action call still returns a clear server-side error.
7. Attempt to push a prospect with no `enrichedEmail`: confirm the equivalent clear error.
8. Run the bulk "Push eligible" action against a mixed selection (some eligible, some not): confirm only eligible rows get pushed and the summary count is accurate.
9. Confirm the Queue tab no longer appears in the sidebar, `/queue` is gone, and every other tab (Prospects, Lead Lists, ICP, Messaging, Engagement, Analytics, Settings) still loads normally with no console errors referencing a missing Queue action.
