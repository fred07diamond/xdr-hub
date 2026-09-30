import { defineAction } from "@agent-native/core/action";
import { writeAppStateForCurrentTab } from "@agent-native/core/application-state";
import { z } from "zod";

export default defineAction({
  description:
    "Navigate the UI. Views: inbound (the board, optional tab and state filters), engagement (needs engagementId), labels, ops, playbook, playbook-change (needs changeId), suggestions, handbook (optional docId), settings, agent (full-page agent). Writes a navigate command the UI reads and deletes.",
  schema: z.object({
    view: z
      .enum([
        "inbound",
        "engagement",
        "labels",
        "ops",
        "playbook",
        "playbook-change",
        "suggestions",
        "handbook",
        "crm",
        "settings",
        "agent",
      ])
      .optional()
      .describe("View to open"),
    engagementId: z
      .string()
      .optional()
      .describe("Engagement to open with view engagement"),
    changeId: z
      .string()
      .optional()
      .describe("Playbook change to open with view playbook-change"),
    docId: z
      .string()
      .optional()
      .describe("Sales handbook doc to open with view handbook"),
    tab: z
      .enum(["mine", "team", "decide", "at_risk", "breached"])
      .optional()
      .describe("Board tab"),
    state: z.string().optional().describe("Board state filter"),
    path: z.string().optional().describe("Exact app path, such as /inbound"),
    threadId: z
      .string()
      .optional()
      .describe("Agent thread to open with view agent"),
  }),
  http: false,
  run: async (args) => {
    if (!args.view && !args.path) {
      throw new Error("Pass --view or --path.");
    }
    if (args.view === "engagement" && !args.engagementId) {
      throw new Error("The engagement view needs --engagementId.");
    }
    const nav: Record<string, string> = {};
    for (const key of [
      "view",
      "engagementId",
      "changeId",
      "tab",
      "state",
      "path",
      "threadId",
    ] as const) {
      const value = args[key];
      if (value) nav[key] = value;
    }
    nav._writeId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    await writeAppStateForCurrentTab("navigate", nav);
    return `Navigating to ${args.view ?? args.path}`;
  },
});
