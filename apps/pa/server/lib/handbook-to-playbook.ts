// The Sales handbook folds into the playbook (D95). Each current handbook doc
// becomes a Knowledge block, proposed as one playbook change that the owner
// or a Playbook admin approves. The text stays in the database (it holds
// private material such as the price anchor and customer evidence), never
// in the repo. Handbook rows are kept as a backup.
import type { ActionRunContext } from "@agent-native/core/action";

import {
  checkPlaybookChange,
  proposeChange,
  submitChange,
  type Actor,
  type Deps,
  type ItemInput,
  type TeamDirectory,
} from "../core/playbook/changes.js";
import { activeRelease } from "../core/playbook/store.js";
import type { HandbookDocRecord } from "../core/repo/types.js";
import { loadPortalSchema } from "./crm-schema.js";
import {
  actorOf,
  playbookDeps,
  replayImpact,
  teamDirectory,
} from "./playbook-service.js";

export const HANDBOOK_PREFIX = "kb.handbook_";

export function handbookEntryId(doc: { id: string }) {
  const slug = doc.id
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 60);
  return `${HANDBOOK_PREFIX}${slug || "doc"}`;
}

/** Docs worth carrying over: current ones, not the index or legacy notes. */
export function docsToFold(docs: HandbookDocRecord[]) {
  return docs
    .filter((doc) => doc.status === "current" && doc.body.trim())
    .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
}

export async function foldHandbookIntoPlaybook(
  ctx: ActionRunContext | undefined,
) {
  return foldHandbook({
    deps: playbookDeps(),
    team: teamDirectory(ctx),
    actor: actorOf(ctx),
    portal: await loadPortalSchema(),
  });
}

/** The move itself, given its dependencies, so tests run it on memory. */
export async function foldHandbook(input: {
  deps: Deps;
  team: TeamDirectory;
  actor: Actor;
  portal: Awaited<ReturnType<typeof loadPortalSchema>> | null;
}) {
  const { deps, team, actor } = input;
  const release = await activeRelease(deps.repo, deps.now());
  const existing = new Set(release.entries.map((entry) => entry.id));
  const docs = docsToFold(await deps.repo.listHandbookDocs()).filter(
    (doc) => !existing.has(handbookEntryId(doc)),
  );
  if (docs.length === 0) return { changeId: null, docs: 0 };
  const start = release.entries.filter(
    (entry) => entry.section === "knowledge",
  ).length;
  const items: ItemInput[] = docs.map((doc, index) => ({
    target: handbookEntryId(doc),
    op: "add",
    after: {
      id: handbookEntryId(doc),
      type: "knowledge",
      block: "knowledge",
      section: "knowledge",
      position: start + index,
      owner: "PA team",
      owner_team: "pa_team",
      body: `${doc.title}\n\n${doc.body}`,
      rationale: `From the Sales handbook doc "${doc.title}", moved into the playbook (D95).`,
    },
  }));
  const change = await proposeChange(deps, team, actor, {
    title: "Sales handbook into the playbook",
    rationale: `The Sales handbook's ${docs.length} current docs become Knowledge blocks, so the playbook is the one place PA reads from.`,
    items,
  });
  await checkPlaybookChange(deps, {
    changeId: change.id,
    impact: replayImpact,
    portal: input.portal,
  });
  await submitChange(deps, team, actor, change.id);
  return { changeId: change.id, docs: docs.length };
}
