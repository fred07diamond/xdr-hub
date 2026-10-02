import { defineAction, fail } from "@agent-native/core/action";
import { z } from "zod";

import { foldHandbookIntoPlaybook } from "../server/lib/handbook-to-playbook.js";
import { orFail } from "../server/lib/playbook-service.js";

export default defineAction({
  description:
    "People only. Move the Sales handbook's current docs into the playbook as Knowledge blocks (D95): one playbook change, checked and sent for approval by the owner or a Playbook admin. Docs already moved are skipped. Nothing is deleted.",
  schema: z.object({}),
  agentTool: false,
  audit: {
    target: () => ({ type: "pa-playbook", id: "handbook" }),
    summary: () => "Moved the Sales handbook into the playbook",
  },
  run: async (_args, ctx) => {
    if (ctx?.caller !== "frontend" && ctx?.caller !== "cli")
      fail("Only people move the handbook", { statusCode: 403 });
    return orFail(() => foldHandbookIntoPlaybook(ctx));
  },
});
