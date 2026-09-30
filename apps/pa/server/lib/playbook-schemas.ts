import { z } from "zod";

export const changeItemInput = z.object({
  target: z
    .string()
    .min(1)
    .describe(
      "An entry id such as rule.precheck.restricted_countries, or config.routing_pool / config.hubspot_mapping",
    ),
  op: z.enum(["add", "update", "retire", "set_config"]),
  after: z
    .unknown()
    .optional()
    .describe(
      "add and update: the full entry (id, type, owner, owner_team, body or params, rationale; version is assigned). set_config: the whole config value. retire: omit.",
    ),
});

const org = { visibility: "org" as const };
export const changeAudit = (verb: string) => ({
  target: (args: { changeId?: string }, result?: unknown) => ({
    type: "pa-playbook-change",
    id:
      args.changeId ??
      (result as { change?: { id?: string } } | undefined)?.change?.id,
    ...org,
  }),
  summary: (args: { changeId?: string; title?: string }) =>
    `${verb} playbook change ${args.title ?? args.changeId ?? ""}`.trim(),
});
