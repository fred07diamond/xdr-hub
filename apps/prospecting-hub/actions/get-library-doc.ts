import { defineAction } from "@agent-native/core";
import { eq } from "@agent-native/core/db/schema";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { libraryDocs } from "../server/db/schema.js";
import { requireRole } from "../server/helpers/require-role.js";

export default defineAction({
  description: "Get a single Sales Library document, including its full text.",
  schema: z.object({ id: z.string().min(1) }),
  requiresAuth: true,
  readOnly: true,
  http: { method: "GET" },
  run: async ({ id }, ctx) => {
    await requireRole(ctx?.userEmail, ["xdr", "ae", "admin"]);
    const db = getDb();

    const rows = await db.select().from(libraryDocs).where(eq(libraryDocs.id, id)).limit(1);
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
