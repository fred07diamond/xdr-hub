// The change workflow (D44, D76): the owner or a Playbook admin approves,
// people publish, edits void approvals, and a change published first forces
// a rebase.
import { beforeEach, describe, expect, it } from "vitest";

import {
  approvalState,
  checkPlaybookChange,
  editChange,
  proposeChange,
  publishChange,
  reviewChange,
  submitChange,
  type Actor,
  type Deps,
  type ItemInput,
  type TeamDirectory,
} from "../../server/core/playbook/changes.js";
import type { Team } from "../../server/core/playbook/checks.js";
import { replayImpact } from "../../server/core/playbook/impact.js";
import { seedRelease } from "../../server/core/playbook/release.js";
import type { ReleaseEntry } from "../../server/core/playbook/schema.js";
import { activeRelease } from "../../server/core/playbook/store.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import { fixedClock, idFactory } from "../helpers.js";

const OWNER = "fred@builder.example.com";
const REVOPS = "ops@builder.example.com";
const PA = "pa@builder.example.com";
const ADMIN = "admin@builder.example.com";

function directory(members: Record<string, Team>): TeamDirectory {
  return {
    async teamOf(email) {
      return members[email] ?? null;
    },
    async isAppOwner(email) {
      return email === OWNER;
    },
    async hasMembers(team) {
      return Object.values(members).includes(team);
    },
  };
}

const person = (email: string): Actor => ({ email, caller: "frontend" });
const agent = (email: string): Actor => ({ email, caller: "tool" });
const entry = (id: string) =>
  seedRelease.entries.find((item) => item.id === id) as ReleaseEntry;

const restrict = (countries: string[]) => ({
  target: "rule.precheck.restricted_countries",
  op: "update" as const,
  after: {
    ...entry("rule.precheck.restricted_countries"),
    params: { countries },
  },
});

describe("playbook changes", () => {
  let repo: MemoryRepository;
  let deps: Deps;
  let team: TeamDirectory;

  beforeEach(() => {
    repo = new MemoryRepository();
    const clock = fixedClock();
    deps = { repo, now: clock.now, newId: idFactory(clock) };
    team = directory({
      [REVOPS]: "revops",
      [PA]: "pa_team",
      [ADMIN]: "admin",
    });
  });

  async function readyForReview(
    author = PA,
    items: ItemInput[] = [restrict(["CU", "IR", "KP", "SY", "RU", "BY"])],
  ) {
    const change = await proposeChange(deps, team, person(author), {
      title: "Restricted countries",
      rationale: "xDR Playbook",
      items,
    });
    await checkPlaybookChange(deps, {
      changeId: change.id,
      impact: replayImpact,
    });
    return submitChange(deps, team, person(author), change.id);
  }

  it("publishes once a Playbook admin approves, and moves the active label", async () => {
    const change = await readyForReview();
    expect(change.requiredTeams).toEqual(["admin"]);
    await reviewChange(deps, team, person(ADMIN), {
      changeId: change.id,
      team: "admin",
      decision: "approve",
    });
    const published = await publishChange(deps, person(ADMIN), change.id);
    expect(published.change.status).toBe("published");
    const active = await activeRelease(repo, deps.now());
    expect(active.id).toBe(published.release.id);
    expect(active.id).not.toBe(seedRelease.id);
    expect(
      active.entries.find((e) => e.id === "rule.precheck.restricted_countries")
        ?.params,
    ).toEqual({
      countries: ["CU", "IR", "KP", "SY", "RU", "BY"],
    });
    // The old release is still there for engagements pinned to it.
    expect(await repo.getRelease(seedRelease.id)).not.toBeNull();
  });

  it("needs the owner or an admin, not RevOps or the PA team (D76)", async () => {
    const both = [
      restrict(["CU"]),
      {
        target: "config.routing_pool",
        op: "set_config" as const,
        after: { pool: [PA] },
      },
    ];
    const change = await readyForReview(PA, both);
    expect(change.requiredTeams).toEqual(["admin"]);
    expect((await approvalState(repo, change)).missing).toEqual(["admin"]);
    await expect(
      publishChange(deps, person(REVOPS), change.id),
    ).rejects.toThrow(/admin/);
    await expect(
      reviewChange(deps, team, person(REVOPS), {
        changeId: change.id,
        team: "admin",
        decision: "approve",
      }),
    ).rejects.toThrow(/Only the owner or a Playbook admin/);
  });

  it("lets the agent draft but never approve or publish", async () => {
    const drafted = await proposeChange(deps, team, agent(PA), {
      title: "Draft",
      rationale: "Suggested",
      items: [restrict(["CU"])],
    });
    expect(drafted.authorKind).toBe("agent");
    await checkPlaybookChange(deps, {
      changeId: drafted.id,
      impact: replayImpact,
    });
    const inReview = await submitChange(deps, team, person(PA), drafted.id);
    await expect(
      reviewChange(deps, team, agent(ADMIN), {
        changeId: inReview.id,
        team: "admin",
        decision: "approve",
      }),
    ).rejects.toThrow(/human decision/);
    await expect(
      publishChange(deps, { email: ADMIN, caller: "automation" }, inReview.id),
    ).rejects.toThrow(/human decision/);
  });

  it("stops an admin approving their own change", async () => {
    const change = await readyForReview(ADMIN);
    await expect(
      reviewChange(deps, team, person(ADMIN), {
        changeId: change.id,
        team: "admin",
        decision: "approve",
      }),
    ).rejects.toThrow(/own change/);
  });

  it("lets the owner approve any change, their own included", async () => {
    const change = await readyForReview(OWNER);
    await reviewChange(deps, team, person(OWNER), {
      changeId: change.id,
      team: "admin",
      decision: "approve",
    });
    const published = await publishChange(deps, person(OWNER), change.id);
    expect(published.change.status).toBe("published");
  });

  it("voids approvals when the change is edited", async () => {
    const change = await readyForReview();
    await reviewChange(deps, team, person(ADMIN), {
      changeId: change.id,
      team: "admin",
      decision: "approve",
    });
    await editChange(deps, team, person(PA), {
      changeId: change.id,
      set: [restrict(["CU"])],
    });
    await expect(
      publishChange(deps, person(ADMIN), change.id),
    ).rejects.toThrow();
    const after = (await repo.getChange(change.id))!;
    expect(after.status).toBe("draft");
    expect((await approvalState(repo, after)).approvals).toEqual([]);
  });

  it("forces a rebase when another change published first, and flags conflicts", async () => {
    const first = await readyForReview();
    const second = await readyForReview(PA, [restrict(["CU"])]);
    await reviewChange(deps, team, person(ADMIN), {
      changeId: first.id,
      team: "admin",
      decision: "approve",
    });
    await publishChange(deps, person(ADMIN), first.id);
    await reviewChange(deps, team, person(ADMIN), {
      changeId: second.id,
      team: "admin",
      decision: "approve",
    });
    await expect(publishChange(deps, person(ADMIN), second.id)).rejects.toThrow(
      /published first/,
    );
    await expect(
      checkPlaybookChange(deps, { changeId: second.id, impact: replayImpact }),
    ).rejects.toThrow(/also changed/);
  });

  it("previews the impact on real pipeline outcomes before anyone approves", async () => {
    // The agency seed case submits from PH: restricting PH disqualifies it.
    const change = await proposeChange(deps, team, person(REVOPS), {
      title: "Test",
      rationale: "Impact",
      items: [restrict(["PH"])],
    });
    const { impact } = await checkPlaybookChange(deps, {
      changeId: change.id,
      impact: replayImpact,
    });
    const agency = impact.find((item) => item.caseId === "agency-already-sal");
    expect(agency?.changed).toBe(true);
    expect(agency?.after.precheck).toBe("disqualify_logged");
    expect(impact.filter((item) => item.changed)).toHaveLength(1);
  });
});
