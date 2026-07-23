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
  fitVerdict: text("fit_verdict", { enum: ["strong", "possible", "weak", "inconclusive"] }),
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
  sentiment: text("sentiment"),   // "positive" | "negative" | null
  message: text("message").notNull(),
  draftNote: text("draft_note"),  // the connection note the user rated
  createdAt: text("created_at").default(now()),
});

// Admin-controlled workspace settings (key-value store).
export const workspaceSettings = table("workspace_settings", {
  key: text("key").primaryKey(),
  value: text("value"),
  updatedAt: text("updated_at").default(now()),
});

// Canvas nodes for the Messaging tab.
// type='persona' nodes are shared (owner_email=null); all other types are per-user.
export const messagingNodes = table("messaging_nodes", {
  id: text("id").primaryKey(),
  type: text("type").notNull().default("user"),
  title: text("title").notNull().default("New Node"),
  ownerEmail: text("owner_email"),
  canvasId: text("canvas_id"),
  personaId: text("persona_id"),
  tone: text("tone"),
  valueProps: text("value_props"),
  phrasesToUse: text("phrases_to_use"),
  phrasesToAvoid: text("phrases_to_avoid"),
  exampleNotes: text("example_notes"),
  notes: text("notes"),
  positionX: integer("position_x").notNull().default(100),
  positionY: integer("position_y").notNull().default(100),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Directed edges between messaging nodes (source → target = parent → child).
// owner_email scopes each edge to the user who created it.
export const messagingEdges = table("messaging_edges", {
  id: text("id").primaryKey(),
  sourceId: text("source_id").notNull(),
  targetId: text("target_id").notNull(),
  ownerEmail: text("owner_email"),
  canvasId: text("canvas_id"),
  createdAt: text("created_at").default(now()),
});

// Named messaging canvases. System templates have is_system=1 and no owner_email.
// User-created canvases are scoped by owner_email.
export const messagingCanvases = table("messaging_canvases", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  templateSlug: text("template_slug"),      // "account" | "role" | "prospect" | "blank" | null
  isSystem: integer("is_system").notNull().default(0),
  ownerEmail: text("owner_email"),           // null for system templates
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// HubSpot outreach queues — each queue mirrors one HubSpot contact list.
export const hubspotQueues = table("hubspot_queues", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email").notNull(),
  name: text("name").notNull(),
  hubspotListId: text("hubspot_list_id").notNull(),
  hubspotListName: text("hubspot_list_name").notNull(),
  status: text("status", { enum: ["active", "done"] }).notNull().default("active"),
  totalCount: integer("total_count").notNull().default(0),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Individual contacts within a HubSpot queue.
export const hubspotQueueItems = table("hubspot_queue_items", {
  id: text("id").primaryKey(),
  queueId: text("queue_id").notNull(),
  hubspotContactId: text("hubspot_contact_id").notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  email: text("email"),
  company: text("company"),
  jobTitle: text("job_title"),
  linkedinUrl: text("linkedin_url"),
  status: text("status", { enum: ["pending", "visited", "skipped"] }).notNull().default("pending"),
  position: integer("position").notNull(),
  createdAt: text("created_at").default(now()),
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
