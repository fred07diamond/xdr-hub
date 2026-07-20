/**
 * Security tests for Builder.LI access control.
 *
 * Three layers must work together to prevent unauthorized access:
 *
 *  1. AUTO_CREATE_DEFAULT_ORG=0 — stops the framework from creating a personal
 *     org for every new sign-in. Without this, any Google user who signs in
 *     automatically becomes owner of their own org and passes membership checks.
 *
 *  2. RequireActiveOrg in root.tsx — blocks the UI for signed-in users who have
 *     no active organization membership. Shows pending invitations and the
 *     domain-join flow instead of the app shell.
 *
 *  3. Org-scoped membership checks — the server middleware (org-membership.ts)
 *     and the extension helper (resolve-owner.ts) must filter org_members by the
 *     WORKSPACE org_id, not just by email. A user who somehow has a personal org
 *     would otherwise pass the email-only check.
 *
 * All three layers are required because:
 *  - Layer 1 alone: users who signed in before the fix already have personal orgs.
 *  - Layer 2 alone: doesn't protect extension API token paths.
 *  - Layer 3 alone: doesn't block the UI shell from loading app data before the
 *    first action call.
 */

import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { describe, expect, it } from "vitest";

const ROOT    = path.resolve(__dirname, "..");
const DB_PATH = path.resolve(ROOT, "data/app.db");

function readFile(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf8");
}

function sql(query: string): string {
  return execSync(`sqlite3 "${DB_PATH}" ${JSON.stringify(query)}`, {
    encoding: "utf8",
  }).trim();
}

// ─── Layer 1 — AUTO_CREATE_DEFAULT_ORG ───────────────────────────────────────

describe("Layer 1 — AUTO_CREATE_DEFAULT_ORG prevents open sign-in", () => {
  it("workspace root .env has AUTO_CREATE_DEFAULT_ORG=0", () => {
    const envPath = path.resolve(ROOT, "../../.env");
    if (!fs.existsSync(envPath)) {
      console.warn("Root .env not found — skipping");
      return;
    }
    const env = fs.readFileSync(envPath, "utf8");
    expect(
      env,
      "AUTO_CREATE_DEFAULT_ORG=0 missing from root .env.\n" +
        "Without this, every new Google sign-in auto-creates a personal org, " +
        "bypassing the invite requirement."
    ).toContain("AUTO_CREATE_DEFAULT_ORG=0");
  });
});

// ─── Layer 2 — RequireActiveOrg in root.tsx ───────────────────────────────────

describe("Layer 2 — RequireActiveOrg blocks uninvited users in UI", () => {
  it("root.tsx imports RequireActiveOrg from @agent-native/core/client/org-team", () => {
    const src = readFile("app/root.tsx");
    expect(
      src,
      "RequireActiveOrg import missing from root.tsx.\n" +
        "Without it, signed-in users with no org membership reach the full app shell."
    ).toContain("RequireActiveOrg");
    expect(src).toContain("@agent-native/core/client/org-team");
  });

  it("root.tsx wraps AppLayout with <RequireActiveOrg>", () => {
    const src = readFile("app/root.tsx");
    expect(
      src,
      "<RequireActiveOrg> wrapper missing in AppContent.\n" +
        "RequireActiveOrg must wrap <AppLayout> so uninvited users see the " +
        "blocking screen before any app data is rendered."
    ).toContain("<RequireActiveOrg>");
    // Also verify the closing tag exists — prevents someone from just importing it
    expect(src).toContain("</RequireActiveOrg>");
  });
});

// ─── Layer 3 — Org-scoped membership checks ──────────────────────────────────

describe("Layer 3 — server middleware + extension helper scope to workspace org", () => {
  it("workspace-org.ts (shared membership helper) binds the orgId column from org_members", () => {
    const src = readFile("server/helpers/workspace-org.ts");
    expect(
      src,
      "workspace-org.ts does not bind org_id column.\n" +
        "Without it the helper cannot filter by workspace org and any user " +
        "who has joined a different org (or whose own personal org exists) passes the check."
    ).toContain("orgId");
  });

  it("org-membership.ts middleware filters by workspaceOrgId", () => {
    const src = readFile("server/middleware/org-membership.ts");
    expect(
      src,
      "org-membership.ts does not use workspaceOrgId in its query.\n" +
        "An email-only check allows a user in any org (including their personal org) through."
    ).toContain("workspaceOrgId");
  });

  it("resolve-owner.ts uses isWorkspaceMember (workspace-scoped check) for extension token path", () => {
    const src = readFile("server/helpers/resolve-owner.ts");
    expect(
      src,
      "resolve-owner.ts does not call isWorkspaceMember().\n" +
        "Extension API token calls bypass the web middleware — this function is the only " +
        "guard for those paths. It must use the workspace-scoped membership check."
    ).toContain("isWorkspaceMember");
  });

  it("workspace-org.ts isWorkspaceMember filters by workspaceOrgId", () => {
    const src = readFile("server/helpers/workspace-org.ts");
    expect(
      src,
      "workspace-org.ts does not filter by workspaceOrgId.\n" +
        "Without org_id scoping, any user in any org (including a personal auto-created org) " +
        "passes the membership check."
    ).toContain("workspaceOrgId");
  });

  it("DB: workspace org can be resolved via WORKSPACE_OWNER_EMAIL owner row", () => {
    if (!fs.existsSync(DB_PATH)) {
      console.warn("No local DB — skipping");
      return;
    }
    const ownerEmail = process.env.WORKSPACE_OWNER_EMAIL ?? "fred@builder.io";
    const orgId = sql(
      `SELECT org_id FROM org_members WHERE lower(email) = lower('${ownerEmail}') AND role = 'owner' LIMIT 1`
    );
    expect(
      orgId,
      `No owner row in org_members for WORKSPACE_OWNER_EMAIL (${ownerEmail}).\n` +
        "The middleware resolves the workspace org by finding the org where the workspace owner " +
        "is the owner. This row must exist."
    ).not.toBe("");
  });
});
