import { table, text, integer, now } from "@agent-native/core/db/schema";

export const workspaceUserRoles = table("workspace_user_roles", {
  email: text("email").primaryKey(),
  role: text("role", { enum: ["xdr", "ae", "admin", "none"] }).notNull().default("none"),
  hubspotAccountId: text("hubspot_account_id"),
  updatedAt: text("updated_at").default(now()),
});

export const workspaceAppAccess = table("workspace_app_access", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  app: text("app", { enum: ["li-agent", "booking", "dispatch"] }).notNull(),
  grantedBy: text("granted_by"),
  grantedAt: text("granted_at").default(now()),
});

// One persona definition, read/written live by both prospecting-hub and
// li-agent -- the actual shared source of truth this table exists for. Union
// of both apps' previously-separate schemas (prospecting-hub's `personas`
// had description/sourceDocUrl/ownerEmail; li-agent's `icpPersonas` had
// isActive/summary/briefing*) so migrating either app's existing rows in
// loses nothing. Criteria/ICP text itself is NOT a column here -- it's
// derived from sharedPersonaDocs below, same "recompute on every doc
// add/delete" pattern both apps already used independently
// (recombinePersonaCriteria / rebuildPersonaIcpText), just against one
// shared doc table now instead of two separate ones.
export const sharedPersonas = table("shared_personas", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  color: text("color"),
  description: text("description"),
  sourceDocUrl: text("source_doc_url"),
  // li-agent's single-active-persona concept -- prospecting-hub has no
  // equivalent and simply never reads/sets this column.
  isActive: integer("is_active").notNull().default(0),
  // li-agent's derived preview text (first paragraph, capped) -- see
  // extractSummary() in li-agent's persona-docs.ts. Recomputed the same way
  // criteria text is, from sharedPersonaDocs.
  summary: text("summary"),
  // li-agent's generated-briefing subsystem (see persona-briefing.ts) --
  // JSON PersonaBriefing blob, versioned/invalidated via briefingSourceHash
  // exactly as before. prospecting-hub never generates or reads this.
  briefing: text("briefing"),
  briefingGeneratedAt: text("briefing_generated_at"),
  briefingSourceHash: text("briefing_source_hash"),
  ownerEmail: text("owner_email"),
  createdAt: text("created_at").default(now()),
  updatedAt: text("updated_at").default(now()),
  // Structured CommonRoom Prospector targeting, settable directly on the
  // Personas page — JSON-encoded string arrays. These are the persona-level
  // source of truth for title/org filters (see run-sourcing-rule-pipeline.ts),
  // replacing the LLM-guessed title keyword as the default once set. There is
  // no server-side "exclude" operator in CommonRoom's filter grammar
  // (confirmed live against the real API), so both exclude lists are always
  // applied as a post-filter, never sent to CommonRoom itself.
  titleIncludeKeywords: text("title_include_keywords"),
  titleExcludeKeywords: text("title_exclude_keywords"),
  orgIncludeList: text("org_include_list"),
  orgExcludeList: text("org_exclude_list"),
});

export const sharedPersonaDocs = table("shared_persona_docs", {
  id: text("id").primaryKey(),
  personaId: text("persona_id").notNull(),
  fileName: text("file_name").notNull(),
  content: text("content").notNull(),
  wordCount: integer("word_count"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: text("created_at").default(now()),
});

// One-time migration review queue: a persona from either app that the
// name-matching pass in migrate-personas-to-shared.ts couldn't confidently
// pair (ambiguous -- multiple same-named personas on one side -- or simply
// unmatched on the other side). Surfaced to an admin to confirm or reject
// rather than guessed. Not a permanent feature table -- safe to drop once
// the one-time migration is complete and confirmed.
export const personaMigrationReviews = table("persona_migration_reviews", {
  id: text("id").primaryKey(),
  // Which app-local record(s) this row is about, for display purposes only
  // (both are already-migrated-or-not local ids, not shared ids).
  prospectingHubPersonaId: text("prospecting_hub_persona_id"),
  prospectingHubPersonaName: text("prospecting_hub_persona_name"),
  liAgentPersonaId: text("li_agent_persona_id"),
  liAgentPersonaName: text("li_agent_persona_name"),
  reason: text("reason", { enum: ["ambiguous_name", "unmatched"] }).notNull(),
  status: text("status", { enum: ["pending", "confirmed_pair", "confirmed_separate"] }).notNull().default("pending"),
  // Set once an admin resolves this row -- the sharedPersonas.id the
  // migration should (or already did) use for the confirmed pairing.
  resolvedSharedPersonaId: text("resolved_shared_persona_id"),
  createdAt: text("created_at").default(now()),
  resolvedAt: text("resolved_at"),
});

// Shared Sales Library: persona-linked reference docs (call scripts, ICP
// notes, positioning, customer evidence) both apps' draft-generation code
// grounds outreach in. Same shape as prospecting-hub's previously-app-local
// `libraryDocs` -- linkedPersonaId now naturally resolves against
// sharedPersonas.id above, which is what makes this genuinely usable from
// li-agent (its old value pointed at a prospecting-hub-only id li-agent
// could never resolve).
export const sharedLibraryDocs = table("shared_library_docs", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  category: text("category", {
    enum: ["icp", "persona_messaging", "sales_process", "campaigns", "tools", "positioning", "other"],
  }).notNull(),
  tags: text("tags"),
  content: text("content").notNull(),
  linkedPersonaId: text("linked_persona_id"),
  linkedIcpId: text("linked_icp_id"),
  sourceFileName: text("source_file_name"),
  ownerEmail: text("owner_email").notNull(),
  createdAt: text("created_at").default(now()),
});
