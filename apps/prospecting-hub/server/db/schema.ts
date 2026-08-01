import { table, text, integer, now } from "@agent-native/core/db/schema";

// Identity note: there is deliberately no User table here. Every
// owner/assignee/actor field below is a plain @builder.io email string,
// matching the ownerEmail convention already used throughout li-agent and
// booking. Role (xdr/ae/admin) comes from the shared workspace_user_roles
// table in packages/shared, not a table owned by this app — see
// server/helpers/require-role.ts.

// One row per contact pulled from HubSpot or CommonRoom.
export const contacts = table("contacts", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  title: text("title"),
  company: text("company"),
  email: text("email"),
  phone: text("phone"),
  linkedinUrl: text("linkedin_url"),
  hubspotUrl: text("hubspot_url"),
  personaMatchScore: integer("persona_match_score"),
  companyFitScore: integer("company_fit_score"),
  engagementScore: integer("engagement_score"),
  overallScore: integer("overall_score"),
  scoreReasoning: text("score_reasoning"),
  country: text("country"), // firmographic signal for deterministic company-fit scoring — HubSpot's associated Company.country or CommonRoom's Contact.location; null when unavailable
  employees: integer("employees"), // firmographic signal for deterministic company-fit scoring — HubSpot's associated Company.numberofemployees; null when unavailable (CommonRoom never sets this — see sync-commonroom.ts)
  source: text("source", { enum: ["hubspot", "commonroom", "prospector"] }).notNull(),
  externalId: text("external_id"), // the source system's own record id, for de-duping re-syncs
  personaId: text("persona_id"), // exactly one persona per contact once matched
  status: text("status", { enum: ["active", "actioned"] }).notNull().default("active"),
  syncedAt: text("synced_at").default(now()),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
});

// A list. "Actioned" segment membership is handled via segment_contacts +
// contact.status, not a status value here — a segment's own status tracks
// its own lifecycle (active/archived), separate from which contacts in it
// have been worked.
export const segments = table("segments", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  assignedToEmail: text("assigned_to_email"), // set when a manager assigns this segment to an XDR/AE
  visibility: text("visibility", { enum: ["private", "public"] }).notNull().default("private"),
  personaId: text("persona_id"),
  filters: text("filters"), // JSON-encoded filter spec used to generate this segment
  status: text("status", { enum: ["active", "archived"] }).notNull().default("active"),
  lastRefreshedAt: text("last_refreshed_at"),
  createdAt: text("created_at").default(now()),
});

// Junction: a contact can appear in multiple segments.
export const segmentContacts = table("segment_contacts", {
  id: text("id").primaryKey(),
  segmentId: text("segment_id").notNull(),
  contactId: text("contact_id").notNull(),
  addedAt: text("added_at").default(now()),
});

// Core persona — manager-owned, tunes the AI sorter.
export const personas = table("personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  color: text("color"), // UI accent color, hex string
  criteria: text("criteria"), // JSON: titles/attributes/rules parsed from source_doc_url
  sourceDocUrl: text("source_doc_url"), // Notion or Google Docs source of truth
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").default(now()),
});

// ICP (Ideal Customer Profile) — manager-owned, company-level qualification
// criteria (firmographics, product fit) rather than the person-level
// targeting personas describe. Mirrors personas' shape (color-accented,
// doc-upload-driven criteria) but has no sub-ICP concept. `product` is a
// plain nullable freeform string (e.g. "Develop", "Publish", or blank for a
// cross-product ICP) — no enum, since nothing should hardcode exactly two
// products.
export const icps = table("icps", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  product: text("product"),
  color: text("color"), // UI accent color, hex string
  criteria: text("criteria"), // JSON: {rawText} via encodePersonaCriteria/decodePersonaCriteria
  sourceDocUrl: text("source_doc_url"),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").default(now()),
});

// Sub-persona — XDR/AE-owned fine-tuning under a core persona.
export const subPersonas = table("sub_personas", {
  id: text("id").primaryKey(),
  personaId: text("persona_id").notNull(),
  name: text("name").notNull(),
  criteria: text("criteria"),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").default(now()),
});

// Junction: a contact can match many sub-personas (but exactly one core persona).
export const contactSubPersonas = table("contact_sub_personas", {
  id: text("id").primaryKey(),
  contactId: text("contact_id").notNull(),
  subPersonaId: text("sub_persona_id").notNull(),
});

// Adoption/usage tracking — the app's own success metric depends on this.
export const analyticsEvents = table("analytics_events", {
  id: text("id").primaryKey(),
  userEmail: text("user_email").notNull(),
  eventType: text("event_type").notNull(), // e.g. segment_created, contact_actioned, sync_run
  metadata: text("metadata"), // JSON, event-specific
  timestamp: text("timestamp").default(now()),
});

// Per-XDR configuration for the scheduled CommonRoom-Prospector pipeline.
// Each rule owns exactly one stable segment (segment_id) that accumulates
// matches across every scheduled run — the segment is created once when the
// rule is created, not regenerated per run.
export const sourcingRules = table("sourcing_rules", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  ownerEmail: text("owner_email").notNull(),
  personaId: text("persona_id").notNull(),
  subPersonaId: text("sub_persona_id"),
  icpId: text("icp_id"), // optional company-level qualification criteria; no FK enforcement, matches this app's convention
  companyAllowList: text("company_allow_list"), // JSON-encoded string array
  companyDenyList: text("company_deny_list"), // JSON-encoded string array
  desiredVolume: integer("desired_volume").notNull().default(20),
  readyByTime: text("ready_by_time").notNull(), // "HH:MM", 24-hour, server-local (single-timezone workspace)
  leadHours: integer("lead_hours").notNull().default(3),
  segmentId: text("segment_id").notNull(),
  jobResourcePath: text("job_resource_path"),
  status: text("status", { enum: ["active", "paused"] }).notNull().default("active"),
  createdAt: text("created_at").default(now()),
});

// Sales Library — reference material (call scripts, ICP notes, positioning
// docs, etc.) any XDR/AE can contribute. `content` stores the raw text
// directly (not JSON-wrapped like persona/ICP criteria). `category`/`tags`
// are AI-derived on create via deriveLibraryTags(), and can be overridden
// later through update-library-doc. `linkedPersonaId`/`linkedIcpId` are
// plain nullable text columns with no FK enforcement, matching this app's
// existing convention (see contacts.personaId).
export const libraryDocs = table("library_docs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category", {
    enum: ["icp", "persona_messaging", "sales_process", "campaigns", "tools", "positioning", "other"],
  }).notNull(),
  tags: text("tags"), // JSON-encoded string array
  content: text("content").notNull(),
  linkedPersonaId: text("linked_persona_id"),
  linkedIcpId: text("linked_icp_id"),
  sourceFileName: text("source_file_name"),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").default(now()),
});

// One row per sync run against an external source. `metadata` is JSON,
// event-specific — added for run-sourcing-rule-pipeline.ts (Task 14 fix
// round) to record `sourcingRuleId`/`companiesConsidered`/
// `icpQualifiedZeroCompanies` so a silently-empty ICP run (0 companies
// qualified, 0 contacts imported, `status: "success"`) is distinguishable
// from "a quiet day, nothing new" instead of indistinguishable from it.
// Null for every other existing writer (sync-hubspot.ts, sync-commonroom.ts,
// import-prospects-to-segment.ts) — none of them needed this before.
export const syncRecords = table("sync_records", {
  id: text("id").primaryKey(),
  source: text("source", { enum: ["hubspot", "commonroom", "notion", "gdocs", "prospector"] }).notNull(),
  startedAt: text("started_at").default(now()),
  completedAt: text("completed_at"),
  recordsPulled: integer("records_pulled"),
  status: text("status", { enum: ["success", "failed", "running"] }).notNull(),
  error: text("error"),
  metadata: text("metadata"),
});
