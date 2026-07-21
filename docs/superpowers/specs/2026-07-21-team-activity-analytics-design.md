# Team Activity Analytics — Design

## Problem

Now that teammates are actively using Builder.LI, the admin (workspace owner)
wants to review team activity: who is adding prospects, who is drafting and
sending connection notes, and how those prospects were scored. Today's
`/analytics` page only shows workspace-wide aggregates (total prospects, verdict
counts, status funnel) with no per-person breakdown.

## Scope

- Add a per-teammate summary table to the existing, already admin-gated
  `/analytics` page.
- Columns: teammate email, prospects added, drafted count, sent count, send
  rate (sent / added), and a compact fit-verdict breakdown (strong / possible /
  weak / inconclusive).
- Summary table only — no drill-down into an individual teammate's prospect
  list in this pass (the main Prospects page already supports viewing
  individual prospects; per-teammate filtering there is out of scope for now).
- No new data tracking. Everything needed already exists on the `prospects`
  table (`ownerEmail`, `status`, `fitVerdict`). "Outcome" in this feature means
  fit verdict and whether a draft was actually sent — not connection-acceptance
  or reply tracking, which the app has no mechanism to observe today (no
  LinkedIn messaging API, and connection-degree is only ever scraped
  client-side, never persisted).

## Data

Extend `apps/outreach/actions/get-analytics.ts` (already `requireAdmin`-gated)
with one additional grouped query over `prospects`, grouped by `ownerEmail`:

```sql
SELECT owner_email,
  COUNT(*) AS total,
  SUM(status = 'drafted') AS drafted,
  SUM(status = 'sent') AS sent,
  SUM(fit_verdict = 'strong') AS strong,
  SUM(fit_verdict = 'possible') AS possible,
  SUM(fit_verdict = 'weak') AS weak,
  SUM(fit_verdict = 'inconclusive') AS inconclusive
FROM prospects
GROUP BY owner_email
ORDER BY total DESC
```

Returned as a new `byUser` array on the existing action's response:

```ts
byUser: Array<{
  ownerEmail: string | null; // null = legacy/pre-auth rows, displayed as "Unassigned"
  total: number;
  drafted: number;
  sent: number;
  strong: number;
  possible: number;
  weak: number;
  inconclusive: number;
}>
```

No schema changes, no new action, no new route.

## UI

In `apps/outreach/app/routes/analytics.tsx`, add a new "Team Activity" section
below the existing "Status Funnel" `Card`, following the same Card-based
visual style as the rest of the page:

- One row per teammate (from `byUser`), sorted by `total` descending (already
  sorted server-side).
- Columns: Teammate (email, or "Unassigned" when `ownerEmail` is null), Added,
  Drafted, Sent, Send Rate (`sent / total`, reusing the page's existing `pct()`
  helper — same convention as the page's existing aggregate `sentRate`), and a
  compact verdict breakdown reusing the existing emerald/amber/rose color
  convention from `VerdictCard`. Note: "Drafted" here means rows *currently*
  sitting at `status = 'drafted'` (not yet sent), not a cumulative count of
  everything ever drafted — a row moves out of the drafted bucket once it's
  sent, matching the mutually-exclusive `status` enum on `prospects`.
- Empty state (no prospects yet / no rows) mirrors the existing
  `FeedbackSection` empty-state pattern (dashed border, muted icon + text).

No new client-side data fetching — `byUser` rides along on the same
`useActionQuery("get-analytics", {})` call the page already makes.

## Auth

No new auth surface. `get-analytics` already calls `requireAdmin(ctx)` server
side, and `analytics.tsx` already redirects non-admins client-side via
`useOrgRole().canManageOrg`. `byUser` is exposed through that same existing
gate — a non-admin caller continues to get the "Admin access required" error
exactly as today.

## Testing

Add a test (new file `test/get-analytics.test.ts` if one doesn't already exist
for this action) that:

- Seeds `prospects` rows across 2+ distinct `ownerEmail` values with a mix of
  `status` and `fitVerdict` values, plus one row with `ownerEmail: null`.
- Asserts `byUser` contains one entry per distinct owner (plus the null/
  "Unassigned" bucket) with correct `total` / `drafted` / `sent` / verdict
  counts, sorted by `total` descending.
- Asserts a non-admin caller (or unauthenticated caller) still gets rejected
  with the existing admin-required error — confirming the new query doesn't
  bypass the existing gate.
