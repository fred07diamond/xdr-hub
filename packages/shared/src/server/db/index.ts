import { createGetDb } from "@agent-native/core/db";
import * as schema from "./schema.js";

export const getSharedDb = createGetDb(schema);
export * from "./schema.js";
