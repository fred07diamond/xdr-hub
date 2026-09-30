import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import {
  evaluatorFor,
  GUIDANCE_TYPES,
} from "../server/core/playbook/capabilities.js";
import { auditRelease } from "../server/core/playbook/checks.js";
import { pendingFor } from "../server/core/playbook/resolve.js";
import type { ReleaseEntry } from "../server/core/playbook/schema.js";
import { activeRelease, repo } from "../server/lib/pa-context.js";
import { actorOf, teamDirectory } from "../server/lib/playbook-service.js";
import { BLOCK_TYPES, blockType, SECTIONS } from "../shared/playbook-blocks.js";

function enforcement(entry: ReleaseEntry): string {
  if (entry.status === "retired") return "retired";
  if (GUIDANCE_TYPES.has(entry.type)) return "guidance";
  if (
    entry.type === "rule" &&
    evaluatorFor(entry.id) &&
    entry.status !== "pending_build"
  )
    return "enforced";
  return "not_enforced";
}

export default defineAction({
  description:
    "The active playbook as a CMS-like builder: sections of typed blocks (country lists, thresholds, clocks, routing order, message rules, knowledge, the CRM mapping), each with its owning team, whether code enforces it, values awaiting confirmation, and its full entry. Also the block palette and the viewer's open draft. Read this before drafting a playbook change.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const repository = repo();
    const release = await activeRelease(repository);
    const actor = actorOf(ctx);
    const directory = teamDirectory(ctx);
    const [role, isAppOwner, open] = await Promise.all([
      directory.teamOf(actor.email),
      directory.isAppOwner(actor.email),
      repository.listChanges({ statuses: ["draft", "in_review"], limit: 100 }),
    ]);
    const findings = auditRelease(release);
    const findingsFor = (target: string) =>
      findings
        .filter((item) => item.target === target)
        .map((item) => item.title);

    const entryBlocks = release.entries
      .filter((entry) => entry.status !== "retired")
      .map((entry) => ({
        target: entry.id,
        kind: "entry" as const,
        block: entry.block ?? null,
        blockLabel: blockType(entry.block)?.label ?? "Entry",
        section: entry.section ?? "rules_of_engagement",
        position: entry.position ?? 0,
        ownerTeam: entry.owner_team,
        owner: entry.owner,
        version: entry.version,
        status: entry.status ?? "active",
        enforcement: enforcement(entry),
        body: entry.body ?? null,
        data: entry.params ?? {},
        raw: entry,
        pending: pendingFor(release, entry.id),
        openFindings: findingsFor(entry.id),
      }));
    const configPending = (source: string) =>
      release.pending_confirmation.filter(
        (item) => item.entry_id === null && item.source === source,
      );
    const configBlocks = [
      {
        target: "config.routing_pool",
        kind: "config" as const,
        block: "person_pool",
        blockLabel: "Round-robin pool",
        section: "routing",
        position: 99,
        ownerTeam: "pa_team",
        owner: "PA lead",
        version: null,
        status: "active",
        enforcement: "enforced",
        body: null,
        data: release.config.routing_pool,
        raw: null,
        pending: configPending("config/routing-pool.yaml"),
        openFindings: [] as string[],
      },
      {
        target: "config.hubspot_mapping",
        kind: "config" as const,
        block: "crm_mapping",
        blockLabel: "CRM field mapping",
        section: "crm",
        position: 99,
        ownerTeam: "revops",
        owner: "RevOps",
        version: null,
        status: "active",
        enforcement: "enforced",
        body: null,
        data: release.config.hubspot_mapping,
        raw: null,
        pending: configPending("config/hubspot-mapping.yaml"),
        openFindings: findings
          .filter((item) => item.kind === "crm_field")
          .map((item) => item.title),
      },
    ];
    const blocks = [...entryBlocks, ...configBlocks];
    const myDraft =
      open.find(
        (change) =>
          change.status === "draft" && change.authorEmail === actor.email,
      ) ?? null;

    return {
      release: {
        id: release.id,
        shortId: release.short_id,
        notes: release.release_notes,
        pendingConfirmations: release.pending_confirmation.length,
      },
      viewer: { email: actor.email, role, isAppOwner },
      sections: SECTIONS.map((section) => ({
        ...section,
        blocks: blocks
          .filter((block) => block.section === section.id)
          .sort((a, b) => a.position - b.position),
      })),
      palette: BLOCK_TYPES.map((type) => ({
        type: type.type,
        label: type.label,
        icon: type.icon,
        description: type.description,
        sections: type.sections,
        defaultOwnerTeam: type.defaultOwnerTeam,
        body: type.body,
        singleton: Boolean(type.singleton),
        storage: type.storage,
        empty: type.empty(),
      })),
      takenIds: release.entries.map((entry) => entry.id),
      myDraft: myDraft
        ? {
            id: myDraft.id,
            title: myDraft.title,
            updatedAt: myDraft.updatedAt,
            itemCount: (await repository.listChangeItems(myDraft.id)).length,
          }
        : null,
      openChanges: open.map((change) => ({
        id: change.id,
        title: change.title,
        status: change.status,
        requiredTeams: change.requiredTeams,
        updatedAt: change.updatedAt,
      })),
    };
  },
});
