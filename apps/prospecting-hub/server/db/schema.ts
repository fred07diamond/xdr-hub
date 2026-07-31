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
  scoreReasoning: text("score_reasoning"),
  source: text("source", { enum: ["hubspot", "commonroom"] }).notNull(),
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

// One row per sync run against an external source.
export const syncRecords = table("sync_records", {
  id: text("id").primaryKey(),
  source: text("source", { enum: ["hubspot", "commonroom", "notion", "gdocs"] }).notNull(),
  startedAt: text("started_at").default(now()),
  completedAt: text("completed_at"),
  recordsPulled: integer("records_pulled"),
  status: text("status", { enum: ["success", "failed", "running"] }).notNull(),
  error: text("error"),
});
