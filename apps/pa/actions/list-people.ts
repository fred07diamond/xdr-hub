import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { canEditHandbook } from "../server/lib/handbook-service.js";
import { repo } from "../server/lib/pa-context.js";
import { listPeopleWithSeen } from "../server/lib/people.js";

export default defineAction({
  description:
    "List the people leads are routed to (D66): each person's role (PA, Enterprise AE, Commercial AE, CSM) and meeting link, plus the owners PA has seen on leads who are not set up yet.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => ({
    people: await listPeopleWithSeen(repo()),
    canEdit: await canEditHandbook(ctx),
  }),
});
