import { defineAction } from "@agent-native/core";
import { z } from "zod";
import { getApolloToken } from "../server/helpers/apollo-client.js";

// TEMPORARY -- one-off live probe to check whether this workspace's Apollo
// key has scope for POST /v1/contacts (create), before building the
// "push list to Apollo" feature against it. Creates one obviously-fake,
// easily-deletable test contact ONLY if scope allows it -- a 403 means
// nothing gets created. Remove this file once the scope question is
// settled either way.
export default defineAction({
  description: "One-off live test of Apollo contacts-create scope. Remove after use.",
  schema: z.object({}),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  http: { method: "GET" },
  run: async () => {
    const apiKey = await getApolloToken();
    if (!apiKey) return { error: "no api key" };
    const res = await fetch("https://api.apollo.io/api/v1/contacts", {
      method: "POST",
      headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        first_name: "ZZZ Scope Test",
        last_name: "Delete Me",
        label_names: ["ZZZ Scope Test - Delete Me"],
      }),
    });
    const text = await res.text();
    let parsed: unknown = text;
    try { parsed = JSON.parse(text); } catch { /* leave as raw text */ }
    return { httpStatus: res.status, response: parsed };
  },
});
