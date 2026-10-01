// The playbook as app data (D44). Releases are immutable and content-hashed;
// the `active` label is the one mutable pointer. The bundled seed release is
// imported the first time a database has no label.
import {
  VersionConflictError,
  type ChangeItemRecord,
  type PaRepository,
  type ReleaseRecord,
} from "../repo/types.js";
import { PlaybookEntryInvalidError, toReleaseEntry } from "./entries.js";
import { canonicalJson, sha256Hex } from "./hash.js";
import { seedRelease } from "./release.js";
import {
  playbookReleaseSchema,
  releaseContentSchema,
  type PendingConfirmation,
  type PlaybookRelease,
  type ReleaseEntry,
  type UnrecognizedKey,
} from "./schema.js";

export const ACTIVE_LABEL = "active";

/** Config targets a change item may set, and the team that owns each. */
export const CONFIG_TARGETS = {
  "config.routing_pool": "pa_team",
  "config.hubspot_mapping": "revops",
} as const;
export type ConfigTarget = keyof typeof CONFIG_TARGETS;

// Which seed source file each config target's pending items came from.
const CONFIG_SOURCES: Record<ConfigTarget, string> = {
  "config.routing_pool": "config/routing-pool.yaml",
  "config.hubspot_mapping": "config/hubspot-mapping.yaml",
};

export class ReleaseBuildError extends Error {}

// Releases never change, so caching by id is safe in a warm process.
const releaseCache = new Map<string, PlaybookRelease>();

export function toReleaseRecord(
  release: PlaybookRelease,
  label: string,
  createdAt: string,
): ReleaseRecord {
  return {
    id: release.id,
    shortId: release.short_id,
    entries: release.entries,
    content: JSON.parse(JSON.stringify(release)) as Record<string, unknown>,
    label,
    createdAt,
  };
}

/** Parses a stored release; a row that no longer matches the schema throws. */
export async function loadRelease(
  repo: PaRepository,
  id: string,
): Promise<PlaybookRelease | null> {
  const cached = releaseCache.get(id);
  if (cached) return cached;
  const stored = await repo.getRelease(id);
  if (!stored) return null;
  const release = playbookReleaseSchema.parse(stored.content);
  if (release.id !== id)
    throw new Error(`Stored release ${id} holds content for ${release.id}`);
  releaseCache.set(id, release);
  return release;
}

// Releases already checked against this seed for a code upgrade (D87).
const upgradeChecked = new Set<string>();

/**
 * Brings a published release up to date with PA's code (D87): an entry
 * nobody edited in the app (still version 1) takes the seed's current
 * content, and blocks the seed added are added. Edited entries, retired
 * entries, blocks added in the app, and config stay as they are. Null when
 * nothing would change.
 */
export function upgradeFromSeed(
  active: PlaybookRelease,
  seed: PlaybookRelease,
): PlaybookRelease | null {
  const seedById = new Map(seed.entries.map((entry) => [entry.id, entry]));
  const activeIds = new Set(active.entries.map((entry) => entry.id));
  const taken = new Set<string>();
  const entries = active.entries.map((entry) => {
    const fresh = seedById.get(entry.id);
    if (!fresh || entry.version !== 1 || entry.status === "retired")
      return entry;
    if (canonicalJson(fresh) === canonicalJson(entry)) return entry;
    taken.add(entry.id);
    return fresh;
  });
  for (const entry of seed.entries)
    if (!activeIds.has(entry.id)) {
      entries.push(entry);
      taken.add(entry.id);
    }
  if (taken.size === 0) return null;
  const content = releaseContentSchema.parse({
    schema: 1,
    release_notes:
      `${active.release_notes} Updated from PA's code: ${[...taken].sort().join(", ")}.`.slice(
        0,
        2000,
      ),
    entries,
    config: active.config,
    pending_confirmation: [
      ...active.pending_confirmation.filter(
        (item) => !item.entry_id || !taken.has(item.entry_id),
      ),
      ...seed.pending_confirmation.filter(
        (item) => item.entry_id && taken.has(item.entry_id),
      ),
    ],
    unrecognized_keys: [
      ...active.unrecognized_keys.filter((key) => !taken.has(key.entry_id)),
      ...seed.unrecognized_keys.filter((key) => taken.has(key.entry_id)),
    ],
  });
  const id = sha256Hex(canonicalJson(content));
  return playbookReleaseSchema.parse({
    ...content,
    id,
    short_id: id.slice(0, 8),
    sources: [{ path: `seed:${seed.short_id}`, sha256: seed.id }],
  });
}

/** The release new engagements pin. Imports the seed on first use. */
export async function activeRelease(
  repo: PaRepository,
  now: Date,
): Promise<PlaybookRelease> {
  return (await activeReleaseWithImport(repo, now)).release;
}

/** Like activeRelease, and says whether this call imported the seed. */
export async function activeReleaseWithImport(
  repo: PaRepository,
  now: Date,
): Promise<{ release: PlaybookRelease; imported: boolean }> {
  let label = await repo.getLabel(ACTIVE_LABEL);
  let imported = false;
  if (!label) {
    const at = now.toISOString();
    await repo.insertReleaseIfAbsent(
      toReleaseRecord(seedRelease, ACTIVE_LABEL, at),
    );
    label = await repo.createLabelIfAbsent({
      label: ACTIVE_LABEL,
      releaseId: seedRelease.id,
      movedBy: "system:seed-import",
      movedAt: at,
      version: 1,
    });
    // Only the call whose label won the race counts as the import.
    imported = label.movedBy === "system:seed-import" && label.movedAt === at;
  }
  if (
    label.movedBy === "system:seed-import" &&
    label.releaseId !== seedRelease.id &&
    (await repo.listChanges({ statuses: ["published"], limit: 1 })).length === 0
  ) {
    // The active release is still an untouched seed import and a newer seed
    // shipped (dev, and the first deploy). Nobody has published, so nothing
    // pins a decision to the old seed; replace it. Published releases never
    // move this way.
    const at = now.toISOString();
    await repo.insertReleaseIfAbsent(
      toReleaseRecord(seedRelease, ACTIVE_LABEL, at),
    );
    try {
      label = await repo.moveLabel(
        ACTIVE_LABEL,
        {
          releaseId: seedRelease.id,
          movedBy: "system:seed-import",
          movedAt: at,
        },
        label.version,
      );
      imported = true;
    } catch (error) {
      if (!(error instanceof VersionConflictError)) throw error;
      label = (await repo.getLabel(ACTIVE_LABEL)) ?? label;
    }
  }
  if (
    label.releaseId !== seedRelease.id &&
    !upgradeChecked.has(`${label.releaseId}:${seedRelease.id}`)
  ) {
    // A published playbook still gets what PA's code changed in entries
    // nobody edited in the app, and new blocks (D87).
    const current = await loadRelease(repo, label.releaseId);
    const upgraded = current ? upgradeFromSeed(current, seedRelease) : null;
    if (upgraded) {
      const at = now.toISOString();
      await repo.insertReleaseIfAbsent(
        toReleaseRecord(upgraded, ACTIVE_LABEL, at),
      );
      try {
        label = await repo.moveLabel(
          ACTIVE_LABEL,
          {
            releaseId: upgraded.id,
            movedBy: "system:seed-upgrade",
            movedAt: at,
          },
          label.version,
        );
      } catch (error) {
        if (!(error instanceof VersionConflictError)) throw error;
        label = (await repo.getLabel(ACTIVE_LABEL)) ?? label;
      }
    } else upgradeChecked.add(`${label.releaseId}:${seedRelease.id}`);
  }
  const release = await loadRelease(repo, label.releaseId);
  if (!release)
    throw new Error(
      `The active label points at missing release ${label.releaseId}`,
    );
  return { release, imported };
}

function valueAt(root: unknown, path: string): unknown {
  let current = root;
  for (const part of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);

function todoPaths(value: unknown, prefix: string): string[] {
  if (value === "TODO") return [prefix];
  if (Array.isArray(value))
    return value.flatMap((item, index) =>
      todoPaths(item, `${prefix}.${index}`),
    );
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, child]) =>
      todoPaths(child, prefix ? `${prefix}.${key}` : key),
    );
  }
  return [];
}

/** The fingerprint approvals and checks are tied to: any edit changes it. */
export function itemsFingerprint(items: ChangeItemRecord[]): string {
  return sha256Hex(
    canonicalJson(
      [...items]
        .sort((a, b) => a.target.localeCompare(b.target))
        .map((item) => ({
          target: item.target,
          op: item.op,
          after: item.afterValue,
        })),
    ),
  );
}

export interface BuildInput {
  base: PlaybookRelease;
  items: ChangeItemRecord[];
  changeId: string;
  notes: string;
  /** Rule entries code cannot evaluate yet publish as pending_build. */
  pendingBuild: ReadonlySet<string>;
}

/** Applies a change set to its base. Pure; throws ReleaseBuildError on bad items. */
export function buildRelease(input: BuildInput): PlaybookRelease {
  const { base, items } = input;
  const entries = new Map<string, ReleaseEntry>(
    base.entries.map((entry) => [entry.id, entry]),
  );
  const unrecognized = new Map<string, UnrecognizedKey[]>();
  for (const key of base.unrecognized_keys) {
    unrecognized.set(key.entry_id, [
      ...(unrecognized.get(key.entry_id) ?? []),
      key,
    ]);
  }
  const config = structuredClone(base.config);
  const changedEntries = new Set<string>();
  const changedConfig = new Set<ConfigTarget>();

  for (const item of items) {
    if (item.op === "set_config") {
      if (!(item.target in CONFIG_TARGETS))
        throw new ReleaseBuildError(
          `${item.target} is not an editable config target`,
        );
      const target = item.target as ConfigTarget;
      if (target === "config.routing_pool") {
        const pool = (item.afterValue as { pool?: unknown })?.pool;
        if (
          !Array.isArray(pool) ||
          pool.some((member) => typeof member !== "string")
        ) {
          throw new ReleaseBuildError(
            "config.routing_pool needs { pool: string[] }",
          );
        }
        config.routing_pool = { pool: pool as string[] };
      } else {
        if (
          !item.afterValue ||
          typeof item.afterValue !== "object" ||
          Array.isArray(item.afterValue)
        ) {
          throw new ReleaseBuildError("config.hubspot_mapping needs a map");
        }
        config.hubspot_mapping = item.afterValue as Record<string, unknown>;
      }
      changedConfig.add(target);
      continue;
    }

    const existing = entries.get(item.target);
    if (item.op === "add" && existing)
      throw new ReleaseBuildError(`${item.target} already exists`);
    if (item.op !== "add" && !existing)
      throw new ReleaseBuildError(`${item.target} is not in the base release`);
    if (item.op === "retire") {
      entries.set(item.target, {
        ...existing!,
        status: "retired",
        version: existing!.version + 1,
      });
      changedEntries.add(item.target);
      continue;
    }
    const raw = item.afterValue as Record<string, unknown> | null;
    if (!raw || typeof raw !== "object")
      throw new ReleaseBuildError(`${item.target}: the new entry is missing`);
    if (raw.id !== item.target)
      throw new ReleaseBuildError(`${item.target}: the entry id cannot change`);
    // Versions are assigned here, never typed by people: every edit is +1.
    const version = existing ? existing.version + 1 : 1;
    let normalized: ReturnType<typeof toReleaseEntry>;
    try {
      normalized = toReleaseEntry({ ...raw, version });
    } catch (error) {
      if (error instanceof PlaybookEntryInvalidError)
        throw new ReleaseBuildError(error.message);
      throw error;
    }
    const entry = normalized.entry;
    if (entry.type === "rule" && input.pendingBuild.has(entry.id))
      entry.status = "pending_build";
    else if (entry.status === "pending_build") entry.status = "active";
    entries.set(item.target, entry);
    unrecognized.set(item.target, normalized.unrecognized);
    changedEntries.add(item.target);
  }

  const nextEntries = [...entries.values()];
  const pending = recomputePending(
    base,
    nextEntries,
    config,
    changedEntries,
    changedConfig,
    input.changeId,
  );
  const content = releaseContentSchema.parse({
    schema: 1,
    release_notes: input.notes,
    entries: nextEntries,
    config,
    pending_confirmation: pending,
    unrecognized_keys: [...unrecognized.values()].flat(),
  });
  const id = sha256Hex(canonicalJson(content));
  return playbookReleaseSchema.parse({
    ...content,
    id,
    short_id: id.slice(0, 8),
    sources: [
      { path: `change:${input.changeId}`, sha256: itemsFingerprint(items) },
    ],
  });
}

/**
 * A pending confirmation stays open while its value is unchanged, and closes
 * when someone sets it. A "TODO" typed in the app opens a new one.
 */
function recomputePending(
  base: PlaybookRelease,
  entries: ReleaseEntry[],
  config: PlaybookRelease["config"],
  changedEntries: Set<string>,
  changedConfig: Set<ConfigTarget>,
  changeId: string,
): PendingConfirmation[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const baseById = new Map(base.entries.map((entry) => [entry.id, entry]));
  const configFor = (source: string) =>
    (Object.keys(CONFIG_SOURCES) as ConfigTarget[]).find(
      (target) => CONFIG_SOURCES[target] === source,
    );
  const configValue = (target: ConfigTarget, from: PlaybookRelease["config"]) =>
    target === "config.routing_pool" ? from.routing_pool : from.hubspot_mapping;

  const kept = base.pending_confirmation.filter((item) => {
    if (item.entry_id) {
      if (!changedEntries.has(item.entry_id)) return true;
      const after = byId.get(item.entry_id);
      if (!after || after.status === "retired") return false;
      return same(
        valueAt(baseById.get(item.entry_id), item.path),
        valueAt(after, item.path),
      );
    }
    const target = configFor(item.source);
    if (!target || !changedConfig.has(target)) return true;
    return same(
      valueAt(configValue(target, base.config), item.path),
      valueAt(configValue(target, config), item.path),
    );
  });

  const open = new Set(
    kept.map((item) => `${item.entry_id ?? item.source}|${item.path}`),
  );
  const added: PendingConfirmation[] = [];
  for (const id of changedEntries) {
    const entry = byId.get(id);
    if (!entry || entry.status === "retired") continue;
    for (const path of todoPaths(entry, "")) {
      if (!open.has(`${id}|${path}`)) {
        added.push({
          source: `change:${changeId}`,
          entry_id: id,
          path,
          value: "TODO",
          note: "Set to TODO in the app",
        });
      }
    }
  }
  for (const target of changedConfig) {
    for (const path of todoPaths(configValue(target, config), "")) {
      const source = CONFIG_SOURCES[target];
      if (!open.has(`${source}|${path}`)) {
        added.push({
          source,
          entry_id: null,
          path,
          value: "TODO",
          note: "Set to TODO in the app",
        });
      }
    }
  }
  return [...kept, ...added];
}
