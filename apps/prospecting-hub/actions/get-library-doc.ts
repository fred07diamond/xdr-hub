import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getSharedDb, sharedLibraryDocs } from "@xdr-hub/shared/server";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Get a single Sales Library document, including its full text.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const sharedDb = getSharedDb();

    const rows = await sharedDb.select().from(sharedLibraryDocs).where(eq(sharedLibraryDocs.id, id)).limit(1);
    const doc = rows[0];
    if (!doc) {
      throw Object.assign(new Error(`Library doc ${id} not found.`), { statusCode: 404 });
    }

    return {
      ...doc,
      tags: doc.tags ? (JSON.parse(doc.tags) as string[]) : [],
    };
  },
});
