// Playbook change sets (D44): draft, check, review by the owning teams,
// publish. The agent may draft; only people approve and publish.
import type { PortalSchema } from "../../../shared/crm-mapping.js";
import type {
  ChangeItemOp,
  ChangeItemRecord,
  ChangeRecord,
  PaRepository,
  SuggestionRecord,
} from "../repo/types.js";
import { VersionConflictError } from "../repo/types.js";
import {
  checkChange,
  type CheckResult,
  type Finding,
  APPROVER,
  type Team,
} from "./checks.js";
import { canonicalJson, sha256Hex } from "./hash.js";
import { playbookEntrySchema, type PlaybookRelease } from "./schema.js";
import {
  ACTIVE_LABEL,
  activeRelease,
  CONFIG_TARGETS,
  itemsFingerprint,
  loadRelease,
  toReleaseRecord,
  type ConfigTarget,
} from "./store.js";

export class ChangeError extends Error {
  constructor(
    message: string,
    readonly statusCode = 400,
  ) {
    super(message);
  }
}

/** Who is on which team. The server backs it with framework app roles. */
export interface TeamDirectory {
  teamOf(email: string): Promise<Team | null>;
  isAppOwner(email: string): Promise<boolean>;
  hasMembers(team: Team): Promise<boolean>;
}

export interface Actor {
  email: string;
  /** How the call arrived: people decide, the agent drafts. */
  caller: string;
}

const PEOPLE_CALLERS = new Set(["frontend", "cli"]);

export function assertPerson(actor: Actor, what: string) {
  if (!PEOPLE_CALLERS.has(actor.caller)) {
    throw new ChangeError(
      `${what} is a human decision; the agent can draft and suggest but not ${what.toLowerCase()}`,
      403,
    );
  }
}

export interface Deps {
  repo: PaRepository;
  now: () => Date;
  newId: () => string;
}

export interface ItemInput {
  target: string;
  op: ChangeItemOp;
  /** The full entry for add and update, the config value for set_config. */
  after?: unknown;
}

/** Approvals and checks are tied to the base release and the exact items. */
export function approvalFingerprint(
  baseReleaseId: string,
  items: ChangeItemRecord[],
): string {
  return sha256Hex(
    canonicalJson({ base: baseReleaseId, items: itemsFingerprint(items) }),
  );
}

function ownerTeamFor(base: PlaybookRelease, input: ItemInput): string {
  if (input.op === "set_config") {
    const team = CONFIG_TARGETS[input.target as ConfigTarget];
    if (!team)
      throw new ChangeError(`${input.target} is not an editable config target`);
    return team;
  }
  const after = input.after as { owner_team?: string } | undefined;
  const existing = base.entries.find((entry) => entry.id === input.target);
  const team = after?.owner_team ?? existing?.owner_team;
  if (!team) throw new ChangeError(`${input.target} needs an owner_team`);
  return team;
}

function beforeFor(base: PlaybookRelease, input: ItemInput): unknown {
  if (input.op === "set_config") {
    return input.target === "config.routing_pool"
      ? base.config.routing_pool
      : base.config.hubspot_mapping;
  }
  return base.entries.find((entry) => entry.id === input.target) ?? null;
}

function toItem(
  deps: Deps,
  changeId: string,
  base: PlaybookRelease,
  input: ItemInput,
): ChangeItemRecord {
  if (
    (input.op === "add" || input.op === "update") &&
    input.after === undefined
  ) {
    throw new ChangeError(`${input.target}: ${input.op} needs the full entry`);
  }
  if (input.op === "add" || input.op === "update") {
    // Shape errors surface now; checks cover params and capabilities.
    const shape = playbookEntrySchema.safeParse({
      ...(input.after as object),
      version: 1,
    });
    if (!shape.success) {
      throw new ChangeError(
        `${input.target}: ${shape.error.issues.map((issue) => issue.message).join("; ")}`,
        422,
      );
    }
  }
  const at = deps.now().toISOString();
  return {
    id: deps.newId(),
    changeId,
    target: input.target,
    op: input.op,
    beforeValue: beforeFor(base, input),
    afterValue: input.op === "retire" ? null : (input.after ?? null),
    ownerTeam: ownerTeamFor(base, input),
    createdAt: at,
    updatedAt: at,
  };
}

async function requireChange(
  repo: PaRepository,
  id: string,
): Promise<ChangeRecord> {
  const change = await repo.getChange(id);
  if (!change) throw new ChangeError("Playbook change not found", 404);
  return change;
}

async function canEdit(
  team: TeamDirectory,
  actor: Actor,
  change: ChangeRecord,
): Promise<boolean> {
  if (actor.email === change.authorEmail) return true;
  if (await team.isAppOwner(actor.email)) return true;
  return (await team.teamOf(actor.email)) !== null;
}

export async function proposeChange(
  deps: Deps,
  team: TeamDirectory,
  actor: Actor,
  input: { title: string; rationale: string; items: ItemInput[] },
): Promise<ChangeRecord> {
  // Applies to the agent too: it drafts as the person it is working for.
  if (
    !(await team.isAppOwner(actor.email)) &&
    !(await team.teamOf(actor.email))
  ) {
    throw new ChangeError(
      "Only the PA team, RevOps, and the app owner can propose playbook changes",
      403,
    );
  }
  if (input.items.length === 0)
    throw new ChangeError("A change needs at least one item");
  const base = await activeRelease(deps.repo, deps.now());
  const at = deps.now().toISOString();
  const change: ChangeRecord = {
    id: deps.newId(),
    title: input.title,
    rationale: input.rationale,
    authorEmail: actor.email,
    authorKind: PEOPLE_CALLERS.has(actor.caller) ? "user" : "agent",
    status: "draft",
    baseReleaseId: base.id,
    resultReleaseId: null,
    requiredTeams: [],
    checks: null,
    impact: null,
    checkedAgainst: null,
    version: 1,
    createdAt: at,
    updatedAt: at,
  };
  const targets = new Set<string>();
  const items = input.items.map((item) => {
    if (targets.has(item.target))
      throw new ChangeError(`${item.target} appears twice in one change`);
    targets.add(item.target);
    return toItem(deps, change.id, base, item);
  });
  await deps.repo.transaction(async (tx) => {
    await tx.insertChange(change);
    for (const item of items) await tx.upsertChangeItem(item);
  });
  return change;
}

/** Replaces or removes items. Any edit voids earlier checks and approvals. */
export async function editChange(
  deps: Deps,
  team: TeamDirectory,
  actor: Actor,
  input: {
    changeId: string;
    set?: ItemInput[];
    remove?: string[];
    title?: string;
    rationale?: string;
  },
): Promise<ChangeRecord> {
  const change = await requireChange(deps.repo, input.changeId);
  if (change.status !== "draft" && change.status !== "in_review") {
    throw new ChangeError(`A ${change.status} change cannot be edited`, 409);
  }
  if (!(await canEdit(team, actor, change)))
    throw new ChangeError("You cannot edit this change", 403);
  const base = await loadRelease(deps.repo, change.baseReleaseId);
  if (!base) throw new ChangeError("The change's base release is missing", 409);
  return deps.repo.transaction(async (tx) => {
    for (const item of input.set ?? [])
      await tx.upsertChangeItem(toItem(deps, change.id, base, item));
    for (const target of input.remove ?? [])
      await tx.deleteChangeItem(change.id, target);
    return tx.updateChange(
      change.id,
      {
        status: "draft",
        checkedAgainst: null,
        title: input.title ?? change.title,
        rationale: input.rationale ?? change.rationale,
        updatedAt: deps.now().toISOString(),
      },
      change.version,
    );
  });
}

export interface ImpactCase {
  caseId: string;
  before: Record<string, string | null>;
  after: Record<string, string | null>;
  changed: boolean;
}

export type ImpactFn = (
  base: PlaybookRelease,
  draft: PlaybookRelease,
) => Promise<ImpactCase[]>;

/**
 * Runs the checks and the impact replay, and rebases the change onto the
 * active release when another change published first.
 */
export async function checkPlaybookChange(
  deps: Deps,
  input: { changeId: string; impact: ImpactFn; portal?: PortalSchema | null },
): Promise<{
  change: ChangeRecord;
  result: CheckResult;
  impact: ImpactCase[];
}> {
  let change = await requireChange(deps.repo, input.changeId);
  if (change.status !== "draft" && change.status !== "in_review") {
    throw new ChangeError(`A ${change.status} change cannot be checked`, 409);
  }
  const active = await activeRelease(deps.repo, deps.now());
  let items = await deps.repo.listChangeItems(change.id);
  if (active.id !== change.baseReleaseId) {
    // Rebase: an entry changed by both this change and the published one is a
    // conflict a person resolves; everything else carries over.
    const previous = await loadRelease(deps.repo, change.baseReleaseId);
    const conflicts = items.filter((item) => {
      if (item.op === "set_config") {
        const key =
          item.target === "config.routing_pool"
            ? "routing_pool"
            : "hubspot_mapping";
        return (
          canonicalJson(previous?.config[key]) !==
          canonicalJson(active.config[key])
        );
      }
      const was = previous?.entries.find((entry) => entry.id === item.target);
      const now = active.entries.find((entry) => entry.id === item.target);
      return canonicalJson(was ?? null) !== canonicalJson(now ?? null);
    });
    if (conflicts.length > 0) {
      throw new ChangeError(
        `Another change published first and also changed ${conflicts.map((item) => item.target).join(", ")}. Update those items against the active release, then check again.`,
        409,
      );
    }
    items = items.map((item) => ({
      ...item,
      beforeValue: beforeFor(active, { target: item.target, op: item.op }),
    }));
    await deps.repo.transaction(async (tx) => {
      for (const item of items) await tx.upsertChangeItem(item);
    });
  }
  const result = checkChange(
    active,
    items,
    change.id,
    `${change.title}\n${change.rationale}`,
    input.portal ?? null,
  );
  const impact = result.release
    ? await input.impact(active, result.release)
    : [];
  change = await deps.repo.updateChange(
    change.id,
    {
      baseReleaseId: active.id,
      requiredTeams: result.requiredTeams,
      checks: {
        ok: result.ok,
        errors: result.errors,
        findings: result.findings,
        pendingBuild: result.pendingBuild,
        draftReleaseId: result.release?.id ?? null,
      },
      impact: {
        cases: impact,
        changed: impact.filter((item) => item.changed).length,
      },
      checkedAgainst: approvalFingerprint(active.id, items),
      updatedAt: deps.now().toISOString(),
    },
    change.version,
  );
  return { change, result, impact };
}

async function assertFresh(
  deps: Deps,
  change: ChangeRecord,
): Promise<ChangeItemRecord[]> {
  const items = await deps.repo.listChangeItems(change.id);
  if (
    !change.checkedAgainst ||
    change.checkedAgainst !== approvalFingerprint(change.baseReleaseId, items)
  ) {
    throw new ChangeError(
      "The change was edited or never checked. Run the checks again.",
      409,
    );
  }
  const checks = change.checks as { ok?: boolean } | null;
  if (!checks?.ok)
    throw new ChangeError(
      "The checks found errors. Fix them before review.",
      409,
    );
  return items;
}

export async function submitChange(
  deps: Deps,
  team: TeamDirectory,
  actor: Actor,
  changeId: string,
) {
  const change = await requireChange(deps.repo, changeId);
  if (change.status !== "draft")
    throw new ChangeError(`A ${change.status} change cannot be submitted`, 409);
  if (!(await canEdit(team, actor, change)))
    throw new ChangeError("You cannot submit this change", 403);
  await assertFresh(deps, change);
  return deps.repo.updateChange(
    change.id,
    { status: "in_review", updatedAt: deps.now().toISOString() },
    change.version,
  );
}

export async function reviewChange(
  deps: Deps,
  team: TeamDirectory,
  actor: Actor,
  input: {
    changeId: string;
    team: Team;
    decision: "approve" | "reject";
    note?: string;
  },
): Promise<{ change: ChangeRecord; onBehalf: boolean }> {
  assertPerson(actor, input.decision === "approve" ? "Approving" : "Rejecting");
  const change = await requireChange(deps.repo, input.changeId);
  if (change.status !== "in_review")
    throw new ChangeError("Only changes in review can be reviewed", 409);
  if (input.team !== APPROVER)
    throw new ChangeError(
      "Playbook edits are approved by the owner or a Playbook admin",
      400,
    );
  const actorTeam = await team.teamOf(actor.email);
  const owner = await team.isAppOwner(actor.email);
  // The owner approves any change, their own included; an admin approves
  // anyone's but their own (D76).
  if (!owner && actorTeam !== APPROVER)
    throw new ChangeError(
      "Only the owner or a Playbook admin can approve playbook edits",
      403,
    );
  if (!owner && actor.email === change.authorEmail)
    throw new ChangeError("An admin cannot approve their own change", 403);
  const onBehalf = false;
  await assertFresh(deps, change);
  const at = deps.now().toISOString();
  return deps.repo.transaction(async (tx) => {
    await tx.insertApproval({
      id: deps.newId(),
      changeId: change.id,
      team: input.team,
      reviewerEmail: actor.email,
      decision: input.decision,
      note: input.note ?? null,
      onBehalf,
      checkedAgainst: change.checkedAgainst as string,
      createdAt: at,
    });
    const next =
      input.decision === "reject"
        ? await tx.updateChange(
            change.id,
            { status: "rejected", updatedAt: at },
            change.version,
          )
        : change;
    return { change: next, onBehalf };
  });
}

/** Changes in review before D76 named owning teams; they now need an approver. */
export function approversOf(change: ChangeRecord): string[] {
  return change.requiredTeams.length > 0 ? [APPROVER] : [];
}

export async function approvalState(repo: PaRepository, change: ChangeRecord) {
  const approvals = (await repo.listApprovals(change.id)).filter(
    (item) =>
      item.decision === "approve" &&
      item.checkedAgainst === change.checkedAgainst,
  );
  const approvedTeams = new Set(approvals.map((item) => item.team));
  const missing = approversOf(change).filter(
    (teamName) => !approvedTeams.has(teamName),
  );
  return {
    approvals,
    missing,
    ready: change.status === "in_review" && missing.length === 0,
  };
}

export interface Published {
  change: ChangeRecord;
  release: PlaybookRelease;
  findings: Finding[];
}

export async function publishChange(
  deps: Deps,
  actor: Actor,
  changeId: string,
  portal: PortalSchema | null = null,
): Promise<Published> {
  assertPerson(actor, "Publishing");
  const change = await requireChange(deps.repo, changeId);
  const state = await approvalState(deps.repo, change);
  if (!state.ready) {
    throw new ChangeError(
      change.status !== "in_review"
        ? `A ${change.status} change cannot be published`
        : `Waiting on approval from ${state.missing.join(" and ")}`,
      409,
    );
  }
  const items = await assertFresh(deps, change);
  const label = await deps.repo.getLabel(ACTIVE_LABEL);
  if (!label || label.releaseId !== change.baseReleaseId) {
    throw new ChangeError(
      "Another change published first. Run the checks again to rebase, then re-approve.",
      409,
    );
  }
  const base = await loadRelease(deps.repo, change.baseReleaseId);
  if (!base) throw new ChangeError("The change's base release is missing", 409);
  const result = checkChange(
    base,
    items,
    change.id,
    `${change.title}\n${change.rationale}`,
    portal,
  );
  if (!result.ok || !result.release)
    throw new ChangeError("The checks no longer pass. Run them again.", 409);
  const release = result.release;
  const at = deps.now().toISOString();
  try {
    const published = await deps.repo.transaction(async (tx) => {
      await tx.insertReleaseIfAbsent(
        toReleaseRecord(release, ACTIVE_LABEL, at),
      );
      await tx.moveLabel(
        ACTIVE_LABEL,
        { releaseId: release.id, movedBy: actor.email, movedAt: at },
        label.version,
      );
      return tx.updateChange(
        change.id,
        { status: "published", resultReleaseId: release.id, updatedAt: at },
        change.version,
      );
    });
    return { change: published, release, findings: result.findings };
  } catch (error) {
    if (error instanceof VersionConflictError) {
      throw new ChangeError(
        "Another change published at the same moment. Run the checks again.",
        409,
      );
    }
    throw error;
  }
}

export async function withdrawChange(
  deps: Deps,
  team: TeamDirectory,
  actor: Actor,
  changeId: string,
) {
  const change = await requireChange(deps.repo, changeId);
  if (change.status !== "draft" && change.status !== "in_review") {
    throw new ChangeError(`A ${change.status} change cannot be withdrawn`, 409);
  }
  if (!(await canEdit(team, actor, change)))
    throw new ChangeError("You cannot withdraw this change", 403);
  return deps.repo.updateChange(
    change.id,
    { status: "withdrawn", updatedAt: deps.now().toISOString() },
    change.version,
  );
}

/** Findings become suggestions, deduped on their key. Returns the new ones. */
export async function recordFindings(
  deps: Deps,
  findings: Finding[],
  links: { releaseId: string | null; changeId: string | null },
): Promise<SuggestionRecord[]> {
  const created: SuggestionRecord[] = [];
  const at = deps.now().toISOString();
  for (const finding of findings) {
    const { record, inserted } = await deps.repo.recordSuggestion({
      id: deps.newId(),
      kind: finding.kind,
      audience: finding.audience,
      title: finding.title,
      body: finding.body,
      evidence: { ...finding.evidence, target: finding.target },
      source: "check",
      releaseId: links.releaseId,
      changeId: links.changeId,
      dedupeKey: finding.dedupeKey,
      status: "open",
      decidedBy: null,
      decidedAt: null,
      notifiedAt: null,
      version: 1,
      createdAt: at,
      updatedAt: at,
    });
    if (inserted) created.push(record);
  }
  return created;
}
