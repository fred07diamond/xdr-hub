// Framework app roles back the playbook's team directory (D44).
// Docs: organizations-teams-permissions#app-roles; types in dist/org/app-roles.d.ts.
import type { ActionRunContext } from "@agent-native/core/action";
import {
  defineAppRoles,
  getRegisteredAppRoles,
  listAppMemberRoles,
  resolveAppRole,
  type AppRoleCaller,
} from "@agent-native/core/org";

import { PLAYBOOK_ROLES } from "../../shared/playbook-roles.js";
import type { TeamDirectory } from "../core/playbook/changes.js";
import type { Team } from "../core/playbook/checks.js";
import { isPaAdmin } from "./pa-context.js";

// Dev servers can load this module in more than one module graph (Nitro and
// Vite SSR), and defineAppRoles rejects a second descriptor object for the same
// appId. Reuse an identical registration; a different vocabulary still throws.
function registerPlaybookRoles() {
  const existing = getRegisteredAppRoles(PLAYBOOK_ROLES.appId);
  if (!existing) return defineAppRoles(PLAYBOOK_ROLES);
  if (JSON.stringify(existing) !== JSON.stringify(PLAYBOOK_ROLES)) {
    throw new Error(
      `App roles for ${PLAYBOOK_ROLES.appId} are already registered with different roles`,
    );
  }
  return {
    resolve: (caller?: AppRoleCaller) => resolveAppRole(existing, caller),
  };
}

export const playbookRoles = registerPlaybookRoles();

export function teamDirectory(
  ctx: ActionRunContext | undefined,
): TeamDirectory {
  const orgId = ctx?.orgId ?? null;
  return {
    async teamOf(email) {
      const found = await playbookRoles.resolve({ userEmail: email, orgId });
      return found.status === "assigned" ? (found.role as Team) : null;
    },
    isAppOwner: (email) => isPaAdmin(email),
    async hasMembers(team) {
      if (!orgId) return false;
      return (await listAppMemberRoles(PLAYBOOK_ROLES.appId, orgId)).some(
        (row) => row.role === team,
      );
    },
  };
}

/** Emails holding a playbook role, for suggestion delivery. */
export async function membersOf(
  team: Team,
  orgId: string | null,
): Promise<string[]> {
  if (!orgId) return [];
  return (await listAppMemberRoles(PLAYBOOK_ROLES.appId, orgId))
    .filter((row) => row.role === team)
    .map((row) => row.email.toLowerCase());
}
