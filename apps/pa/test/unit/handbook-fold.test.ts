// The Sales handbook folds into the playbook's Knowledge section (D95).
import { describe, expect, it } from "vitest";

import {
  publishChange,
  reviewChange,
  type TeamDirectory,
} from "../../server/core/playbook/changes.js";
import { activeRelease } from "../../server/core/playbook/store.js";
import { MemoryRepository } from "../../server/core/repo/memory.js";
import type { HandbookDocRecord } from "../../server/core/repo/types.js";
import {
  foldHandbook,
  handbookEntryId,
} from "../../server/lib/handbook-to-playbook.js";
import { fixedClock, idFactory } from "../helpers.js";

const OWNER = "owner@example.com";
const team: TeamDirectory = {
  teamOf: async () => null,
  isAppOwner: async (email) => email === OWNER,
  hasMembers: async () => false,
};

const doc = (
  id: string,
  status: HandbookDocRecord["status"],
  body: string,
): HandbookDocRecord => ({
  id,
  title: id.replace(/^\d+-/, "").replace(/-/g, " "),
  summary: null,
  body,
  position: Number(id.slice(0, 2)) || 0,
  status,
  source: null,
  version: 1,
  updatedBy: OWNER,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
});

describe("folding the Sales handbook into the playbook", () => {
  it("proposes one change of Knowledge blocks, then skips what moved", async () => {
    const repo = new MemoryRepository();
    const clock = fixedClock();
    const deps = { repo, now: clock.now, newId: idFactory(clock) };
    await repo.insertHandbookDoc(doc("00-readme", "index", "Index of docs"));
    await repo.insertHandbookDoc(
      doc(
        "05-email-playbook",
        "current",
        "# Email playbook\n\nUse one proof point.",
      ),
    );
    await repo.insertHandbookDoc(
      doc("03-lead-routing", "current", "# Lead routing\n\nAgencies go first."),
    );
    await repo.insertHandbookDoc(doc("09-old", "legacy", "Old notes"));
    const actor = { email: OWNER, caller: "frontend" };

    const moved = await foldHandbook({ deps, team, actor, portal: null });
    expect(moved.docs).toBe(2);
    expect(handbookEntryId({ id: "05-email-playbook" })).toBe(
      "kb.handbook_05_email_playbook",
    );
    await reviewChange(deps, team, actor, {
      changeId: moved.changeId!,
      team: "admin",
      decision: "approve",
    });
    await publishChange(deps, actor, moved.changeId!);
    const release = await activeRelease(repo, clock.now());
    const kb = release.entries.find(
      (entry) => entry.id === "kb.handbook_05_email_playbook",
    );
    expect(kb?.section).toBe("knowledge");
    expect(kb?.body).toContain("Use one proof point.");
    expect(
      release.entries.some((entry) => entry.id === "kb.handbook_09_old"),
    ).toBe(false);

    // Running it again finds nothing left to move.
    expect((await foldHandbook({ deps, team, actor, portal: null })).docs).toBe(
      0,
    );
  });
});
