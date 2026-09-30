// Request identity: framework docs actions-run-context (ctx.userEmail).
import type { ActionRunContext } from "@agent-native/core/action";
import { getWorkspaceRole } from "@xdr-hub/shared/server";

import { ulid } from "../core/ids.js";
import { recordFindings } from "../core/playbook/changes.js";
import { auditRelease } from "../core/playbook/checks.js";
import type { PlaybookRelease } from "../core/playbook/schema.js";
import { activeReleaseWithImport } from "../core/playbook/store.js";
import type { PaRepository } from "../core/repo/types.js";
import type { Viewer } from "../core/views/inbound.js";
import { paRepository } from "../db/repository.js";

export const newId = () => ulid();
export const now = () => new Date();

let migrationsReady: Promise<void> | null = null;

export function markMigrationsRunning(done: Promise<unknown>) {
  migrationsReady = done.then(() => undefined);
}

export function repo(): PaRepository {
  return paRepository();
}

/**
 * The active playbook release (D44). Waits for migrations on a cold start, and
 * imports the bundled seed into an empty database. One query per call: the
 * label can move whenever a change publishes, so it is never cached.
 */
export async function activeRelease(
  repository: PaRepository = repo(),
): Promise<PlaybookRelease> {
  if (migrationsReady) await migrationsReady;
  const { release, imported } = await activeReleaseWithImport(
    repository,
    now(),
  );
  if (imported) {
    // The seed's gaps (unmapped CRM fields, params code does not read) become
    // suggestions right away, so RevOps and the app owner see them on day one.
    await recordFindings(
      { repo: repository, now, newId },
      auditRelease(release),
      { releaseId: release.id, changeId: null },
    );
  }
  return release;
}

export async function viewerFor(
  ctx: ActionRunContext | undefined,
  repository: PaRepository,
): Promise<Viewer & { isAdmin: boolean }> {
  const userId = ctx?.userEmail ?? null;
  const isAdmin = await isPaAdmin(userId);
  return { userId, isAdmin, canReplay: canReplaySynthetic(userId, isAdmin) };
}

/**
 * Admin rights come from the shared workspace role (D18), not from the PA
 * profile, whose `roles` are PA domain labels (pa, ae, csm). Fails closed.
 */
export async function isPaAdmin(userId: string | null): Promise<boolean> {
  if (!userId) return false;
  try {
    return (await getWorkspaceRole(userId)) === "admin";
  } catch (error) {
    console.warn(
      "[pa] Workspace role lookup failed; treating caller as non-admin:",
      error instanceof Error ? error.message : error,
    );
    return false;
  }
}

/**
 * Synthetic replays write shadow data only. Local and preview builds allow any
 * signed-in caller so the first load can seed the admin profile; production
 * requires the admin role on the caller's PA profile.
 */
export function canReplaySynthetic(
  userId: string | null,
  isAdmin: boolean,
): boolean {
  if (!userId) return false;
  if (isAdmin) return true;
  return process.env.NODE_ENV !== "production";
}
