import { defineAction } from "@agent-native/core/action";
import { z } from "zod";

import { BLOCK_TYPES, SECTIONS } from "../shared/playbook-blocks.js";

export default defineAction({
  description:
    "The playbook's block vocabulary: every block type with its sections, owning team, storage (entry type and id prefix, or config target), data JSON Schema, empty value, and build brief. Use it to draft a new block with propose-playbook-change: add an entry with block, section, position, owner_team, and params that match the schema.",
  schema: z.object({}),
  http: { method: "GET" },
  readOnly: true,
  run: async () => ({
    sections: SECTIONS,
    blocks: BLOCK_TYPES.map((type) => {
      let dataSchema: unknown = null;
      try {
        dataSchema = z.toJSONSchema(type.schema, { unrepresentable: "any" });
      } catch {
        dataSchema = null;
      }
      return {
        type: type.type,
        label: type.label,
        description: type.description,
        sections: type.sections,
        defaultOwnerTeam: type.defaultOwnerTeam,
        storage: type.storage,
        body: type.body,
        singleton: Boolean(type.singleton),
        empty: type.empty(),
        dataSchema,
        brief: type.brief,
      };
    }),
  }),
});
