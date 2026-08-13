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
  // Apollo.io enrichment — on-demand, triggered from the Prospects table
  // (enrich-prospect.ts). Same shape as lead_list_items' enrichment columns.
  enrichmentStatus: text("enrichment_status", { enum: ["idle", "enriching", "done", "not_found", "failed"] })
    .notNull()
    .default("idle"),
  enrichedEmail: text("enriched_email"),
  enrichedTitle: text("enriched_title"),
  enrichedLinkedinUrl: text("enriched_linkedin_url"),
  enrichedCompanyIndustry: text("enriched_company_industry"),
  enrichedCompanySize: integer("enriched_company_size"),
  enrichedAt: text("enriched_at"),
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
  resolvedAt: text("resolved_at"), // null = active; set to ISO string when resolved
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
  // Set on hubspot_reference nodes so a future "Refresh" can re-pull without re-searching.
  hubspotContactId: text("hubspot_contact_id"),
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

// Sales Navigator lead lists imported by the extension — each import creates
// a new list entity (same behavior as HubSpot queues re-importing a list,
// verified against import-hubspot-queue.ts, which has no upsert/merge logic).
// ownerEmail is nullable, unlike hubspotQueues.ownerEmail, because this is
// written by a public/unauthenticated action (resolveOwner() can return
// null) — same nullable-owner shape as prospects/postEngagements.
// Shallow import only: no ICP scoring or draft note happens here. That still
// happens later, per-lead, through the existing capture-profile flow when
// the xDR opens that lead's actual profile page.
export const leadLists = table("lead_lists", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  name: text("name").notNull(),
  salesNavListUrl: text("sales_nav_list_url"),
  totalCount: integer("total_count").notNull().default(0),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Individual leads within a Sales Navigator lead list. profileUrl (the
// public /in/... URL) is null at import time — a list page has N leads, so
// there's no reliable single-link scan to resolve it the way a single lead's
// profile page can. It gets filled in later once the xDR actually opens that
// lead's profile and the existing capture flow runs. salesNavLeadUrl (the
// /sales/lead/... link) is always present at import time and is what "Open
// LinkedIn" falls back to until profileUrl is resolved.
export const leadListItems = table("lead_list_items", {
  id: text("id").primaryKey(),
  listId: text("list_id").notNull(),
  name: text("name"),
  headline: text("headline"),
  company: text("company"),
  location: text("location"),
  profileUrl: text("profile_url"),
  salesNavLeadUrl: text("sales_nav_lead_url"),
  status: text("status", { enum: ["pending", "visited", "skipped"] }).notNull().default("pending"),
  position: integer("position").notNull(),
  // Apollo.io enrichment — on-demand, triggered from the Lead Lists page
  // (enrich-lead-list-item.ts), not part of the shallow import above.
  // enrichedLinkedinUrl is kept separate from profileUrl, which stays
  // reserved for the value the capture-profile flow resolves when the xDR
  // actually opens the lead's LinkedIn page (see comment above).
  enrichmentStatus: text("enrichment_status", { enum: ["idle", "enriching", "done", "not_found", "failed"] })
    .notNull()
    .default("idle"),
  enrichedEmail: text("enriched_email"),
  enrichedTitle: text("enriched_title"),
  enrichedLinkedinUrl: text("enriched_linkedin_url"),
  enrichedCompanyIndustry: text("enriched_company_industry"),
  enrichedCompanySize: integer("enriched_company_size"),
  enrichedAt: text("enriched_at"),
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

// Post engagements — one row per LinkedIn post comment that has been processed.
// Status lifecycle: pending → enriching → scoring → done
export const postEngagements = table("post_engagements", {
  id: text("id").primaryKey(),
  ownerEmail: text("owner_email"),
  postUrl: text("post_url").notNull(),
  postTitle: text("post_title"),
  engagerName: text("engager_name").notNull(),
  engagerCompany: text("engager_company"),
  engagerHeadline: text("engager_headline"),
  engagerRole: text("engager_role"),
  engagerAbout: text("engager_about"),
  engagerRecentActivity: text("engager_recent_activity"),
  engagerProfileUrl: text("engager_profile_url").notNull(),
  commentText: text("comment_text"),
  xdrOwner: text("xdr_owner"),
  contactOwner: text("contact_owner"),
  companyOwner: text("company_owner"),
  hubspotStatus: text("hubspot_status", { enum: ["found", "new_opportunity"] }),
  hubspotContactUrl: text("hubspot_contact_url"),
  fitVerdict: text("fit_verdict", { enum: ["strong", "possible", "weak", "inconclusive"] }),
  fitReason: text("fit_reason"),
  draftNote: text("draft_note"),
  personaId: text("persona_id"),
  personaName: text("persona_name"),
  personaColor: text("persona_color"),
  status: text("status", { enum: ["pending", "enriching", "scoring", "done"] })
    .notNull()
    .default("pending"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// Fixed-window rate-limit counters. One row per (bucket, action) pair; the
// window resets whenever a check finds windowStart older than the window size.
export const rateLimitCounters = table("rate_limit_counters", {
  id: text("id").primaryKey(),
  count: integer("count").notNull().default(0),
  windowStart: text("window_start").notNull(),
});
