import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { commercialLine } from "../server/core/lead-route/engagement.js";
import { canEditHandbook } from "../server/lib/handbook-service.js";
import { activeRelease, repo } from "../server/lib/pa-context.js";
import { listPeopleWithSeen } from "../server/lib/people.js";

export default defineAction({
  description:
    "List the people leads are routed to (D66): each person's role (PA, Enterprise AE, Commercial AE, CSM) and meeting link, plus the owners PA has seen on leads who are not set up yet.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async (_args, ctx) => {
    const repository = repo();
    const [people, assignments, release, canEdit] = await Promise.all([
      listPeopleWithSeen(repository),
      repository.listAeAssignments(),
      activeRelease(repository),
      canEditHandbook(ctx),
    ]);
    // Leads each Enterprise AE was given by the round robin (D78).
    const given = new Map<string, number>();
    for (const item of assignments)
      if (item.method !== "carried")
        given.set(item.aeEmail, (given.get(item.aeEmail) ?? 0) + 1);
    return {
      people: people.map((person) => ({
        ...person,
        roundRobinLeads: given.get(person.email) ?? 0,
      })),
      commercialLine: commercialLine(release),
      canEdit,
    };
  },
});
