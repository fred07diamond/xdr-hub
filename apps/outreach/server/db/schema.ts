import { table, text, integer, now } from "@agent-native/core/db/schema";

// One row per ICP persona. One can be marked active (is_active=1) at a time.
export const icpPersonas = table("icp_personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color").notNull().default("#6366f1"),
  icpText: text("icp_text"),
  summary: text("summary"),
  isActive: integer("is_active").notNull().default(0),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Personal API tokens — one per user, used by the extension to identify callers.
export const apiTokens = table("api_tokens", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  token: text("token").notNull(),
  createdAt: text("created_at").default(now()),
});

// One row per LinkedIn profile the extension has ever captured, per user.
// Status lifecycle: captured → drafted → sent
export const prospects = table("prospects", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  profileUrl: text("profile_url").notNull(),
  name: text("name"),
  headline: text("headline"),
  role: text("role"),
  company: text("company"),
  about: text("about"),
  recentActivity: text("recent_activity"),
  fitVerdict: text("fit_verdict", { enum: ["strong", "possible", "weak"] }),
  fitReason: text("fit_reason"),
  draftNote: text("draft_note"),
  draftFollowUp: text("draft_follow_up"),
  personaId: text("persona_id"),
  personaName: text("persona_name"),
  personaColor: text("persona_color"),
  rating: integer("rating"),       // 1 = thumbs up, -1 = thumbs down
  ratingNote: text("rating_note"),
  status: text("status", { enum: ["captured", "drafted", "sent"] })
    .notNull()
    .default("captured"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// One row per manual send — written by mark-sent, read by check-already-contacted.
export const sendHistory = table("send_history", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  profileUrl: text("profile_url").notNull(),
  sentAt: text("sent_at").default(now()),
});

// User-submitted feedback messages.
export const feedback = table("feedback", {
  id: text("id").primaryKey(),
  userEmail: text("user_email"),
  message: text("message").notNull(),
  createdAt: text("created_at").default(now()),
});

// Admin-controlled workspace settings (key-value store).
export const workspaceSettings = table("workspace_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: text("updated_at").default(now()),
});

// Singleton row that holds ICP configuration.
// icpText: the full text of the user's uploaded ICP document — used by
//   capture-profile to score and draft every captured LinkedIn profile.
// sources: legacy Notion page IDs array, kept for backward compatibility.
export const icpSources = table("icp_sources", {
  id: text("id").primaryKey().default("singleton"),
  sources: text("sources").notNull().default("[]"),
  icpText: text("icp_text"),
  updatedAt: text("updated_at").default(now()),
});
