import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import {
  approvalFingerprint,
  approvalState,
} from "../server/core/playbook/changes.js";
import { repo } from "../server/lib/pa-context.js";
import { actorOf, teamDirectory } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "One playbook change set: its items (before and after), the last checks (errors and findings), the replay impact on synthetic cases, approvals by team, whether it is ready to publish, and what the viewer may do.",
  schema: z.object({ changeId: z.string().min(1) }),
  http: { method: "GET" },
  readOnly: true,
  run: async (args, ctx) => {
    const repository = repo();
    const change = await repository.getChange(args.changeId);
    if (!change) fail("Playbook change not found", { statusCode: 404 });
    const [items, state] = await Promise.all([
      repository.listChangeItems(change.id),
      approvalState(repository, change),
    ]);
    const actor = actorOf(ctx);
    const directory = teamDirectory(ctx);
    const [role, isAppOwner] = await Promise.all([
      directory.teamOf(actor.email),
      directory.isAppOwner(actor.email),
    ]);
    const fresh =
      change.checkedAgainst !== null &&
      change.checkedAgainst ===
        approvalFingerprint(change.baseReleaseId, items);
    return {
      change,
      items,
      checksFresh: fresh,
      approvals: (await repository.listApprovals(change.id)).map((item) => ({
        ...item,
        current: item.checkedAgainst === change.checkedAgainst,
      })),
      missingTeams: state.missing,
      readyToPublish: state.ready && fresh,
      viewer: {
        role,
        isAppOwner,
        isAuthor: actor.email === change.authorEmail,
        canReviewFor: change.requiredTeams.filter(
          (team) => team === role || isAppOwner,
        ),
      },
    };
  },
});
