// The change workflow (D44): owning teams approve, people publish, edits void
// approvals, and a change published first forces a rebase.
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
    team = directory({ [REVOPS]: "revops", [PA]: "pa_team" });
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

  it("publishes once the owning team approves, and moves the active label", async () => {
    const change = await readyForReview();
    expect(change.requiredTeams).toEqual(["revops"]);
    await reviewChange(deps, team, person(REVOPS), {
      changeId: change.id,
      team: "revops",
      decision: "approve",
    });
    const published = await publishChange(deps, person(REVOPS), change.id);
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

  it("does not publish before every owning team approves", async () => {
    const both = [
      restrict(["CU"]),
      {
        target: "config.routing_pool",
        op: "set_config" as const,
        after: { pool: [PA] },
      },
    ];
    const change = await readyForReview(OWNER, both);
    expect(change.requiredTeams).toEqual(["pa_team", "revops"]);
    await reviewChange(deps, team, person(REVOPS), {
      changeId: change.id,
      team: "revops",
      decision: "approve",
    });
    expect((await approvalState(repo, change)).missing).toEqual(["pa_team"]);
    await expect(
      publishChange(deps, person(REVOPS), change.id),
    ).rejects.toThrow(/pa_team/);
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
      reviewChange(deps, team, agent(REVOPS), {
        changeId: inReview.id,
        team: "revops",
        decision: "approve",
      }),
    ).rejects.toThrow(/human decision/);
    await expect(
      publishChange(deps, { email: REVOPS, caller: "automation" }, inReview.id),
    ).rejects.toThrow(/human decision/);
  });

  it("stops the author approving their own change, and people outside the team", async () => {
    const change = await readyForReview(REVOPS);
    await expect(
      reviewChange(deps, team, person(REVOPS), {
        changeId: change.id,
        team: "revops",
        decision: "approve",
      }),
    ).rejects.toThrow(/author/);
    await expect(
      reviewChange(deps, team, person(PA), {
        changeId: change.id,
        team: "revops",
        decision: "approve",
      }),
    ).rejects.toThrow(/Only revops/);
  });

  it("voids approvals when the change is edited", async () => {
    const change = await readyForReview();
    await reviewChange(deps, team, person(REVOPS), {
      changeId: change.id,
      team: "revops",
      decision: "approve",
    });
    await editChange(deps, team, person(PA), {
      changeId: change.id,
      set: [restrict(["CU"])],
    });
    await expect(
      publishChange(deps, person(REVOPS), change.id),
    ).rejects.toThrow();
    const after = (await repo.getChange(change.id))!;
    expect(after.status).toBe("draft");
    expect((await approvalState(repo, after)).approvals).toEqual([]);
  });

  it("lets the app owner stand in only while a team has no members", async () => {
    team = directory({ [PA]: "pa_team" });
    const change = await readyForReview();
    const { onBehalf } = await reviewChange(deps, team, person(OWNER), {
      changeId: change.id,
      team: "revops",
      decision: "approve",
    });
    expect(onBehalf).toBe(true);

    team = directory({ [PA]: "pa_team", [REVOPS]: "revops" });
    const second = await readyForReview(PA, [restrict(["CU"])]);
    await expect(
      reviewChange(deps, team, person(OWNER), {
        changeId: second.id,
        team: "revops",
        decision: "approve",
      }),
    ).rejects.toThrow(/Only revops/);
  });

  it("forces a rebase when another change published first, and flags conflicts", async () => {
    const first = await readyForReview();
    const second = await readyForReview(PA, [restrict(["CU"])]);
    await reviewChange(deps, team, person(REVOPS), {
      changeId: first.id,
      team: "revops",
      decision: "approve",
    });
    await publishChange(deps, person(REVOPS), first.id);
    await reviewChange(deps, team, person(REVOPS), {
      changeId: second.id,
      team: "revops",
      decision: "approve",
    });
    await expect(
      publishChange(deps, person(REVOPS), second.id),
    ).rejects.toThrow(/published first/);
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
