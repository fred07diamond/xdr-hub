import { defineAction } from "@agent-native/core";
import { deleteWorkspaceConnection } from "@agent-native/core/workspace-connections";
import { getRequestUserEmail } from "@agent-native/core/server";
import { requireWorkspaceAdmin } from "@xdr-hub/shared/server";
import { z } from "zod";

export default defineAction({
  description: "Delete a shared workspace integration connection. Admin only.",
  schema: z.object({
    id: z.string().describe("Workspace connection ID to delete."),
  }),
  requiresAuth: true,
  run: async ({ id }) => {
    await requireWorkspaceAdmin(await getRequestUserEmail());
    const deleted = await deleteWorkspaceConnection(id);
    if (!deleted) {
      throw new Error(`Workspace connection "${id}" was not found.`);
    }
    return { id, deleted };
  },
});
