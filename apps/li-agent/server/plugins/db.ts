import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      sql: `CREATE TABLE IF NOT EXISTS prospects (
        id TEXT PRIMARY KEY,
        profile_url TEXT NOT NULL UNIQUE,
        name TEXT,
        headline TEXT,
        role TEXT,
        company TEXT,
        about TEXT,
        recent_activity TEXT,
        fit_verdict TEXT,
        fit_reason TEXT,
        draft_note TEXT,
        draft_follow_up TEXT,
        status TEXT NOT NULL DEFAULT 'captured',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 2,
      sql: `CREATE TABLE IF NOT EXISTS send_history (
        id TEXT PRIMARY KEY,
        profile_url TEXT NOT NULL,
        sent_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 3,
      sql: `CREATE TABLE IF NOT EXISTS icp_sources (
        id TEXT PRIMARY KEY DEFAULT 'singleton',
        sources TEXT NOT NULL DEFAULT '[]',
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 4,
      sql: `ALTER TABLE prospects ADD COLUMN persona_id TEXT`,
    },
    {
      version: 5,
      sql: `ALTER TABLE prospects ADD COLUMN persona_name TEXT`,
    },
    {
      version: 6,
      sql: `ALTER TABLE prospects ADD COLUMN persona_color TEXT`,
    },
    {
      version: 7,
      sql: `CREATE TABLE IF NOT EXISTS icp_personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT NOT NULL DEFAULT '#6366f1',
        icp_text TEXT,
        summary TEXT,
        is_active INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    // Rebuild prospects: drop global profile_url UNIQUE, add owner_email, compound unique index.
    // Multi-statement migration — the framework splits on ';' and runs each in sequence.
    {
      version: 8,
      sql: [
        `CREATE TABLE IF NOT EXISTS prospects_v2 (
          id TEXT PRIMARY KEY,
          owner_email TEXT,
          profile_url TEXT NOT NULL,
          name TEXT, headline TEXT, role TEXT, company TEXT, about TEXT, recent_activity TEXT,
          fit_verdict TEXT, fit_reason TEXT, draft_note TEXT, draft_follow_up TEXT,
          persona_id TEXT, persona_name TEXT, persona_color TEXT,
          status TEXT NOT NULL DEFAULT 'captured',
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )`,
        `INSERT INTO prospects_v2
          SELECT id, NULL as owner_email, profile_url, name, headline, role, company, about,
                 recent_activity, fit_verdict, fit_reason, draft_note, draft_follow_up,
                 persona_id, persona_name, persona_color, status, created_at, updated_at
          FROM prospects
          ON CONFLICT DO NOTHING`,
        `DROP TABLE IF EXISTS prospects`,
        `ALTER TABLE prospects_v2 RENAME TO prospects`,
        `CREATE UNIQUE INDEX IF NOT EXISTS prospects_url_owner ON prospects(profile_url, COALESCE(owner_email, ''))`,
      ].join(";\n"),
    },
    {
      version: 9,
      sql: `ALTER TABLE send_history ADD COLUMN owner_email TEXT`,
    },
    {
      version: 10,
      sql: `CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        token TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    { version: 11, sql: `ALTER TABLE prospects ADD COLUMN rating INTEGER` },
    { version: 12, sql: `ALTER TABLE prospects ADD COLUMN rating_note TEXT` },
    {
      version: 13,
      sql: `CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        user_email TEXT,
        message TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 14,
      sql: `ALTER TABLE icp_sources ADD COLUMN IF NOT EXISTS icp_text TEXT`,
    },
    {
      version: 15,
      sql: `CREATE TABLE IF NOT EXISTS workspace_settings (
        key TEXT PRIMARY KEY,
        value TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 16,
      sql: `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS sentiment TEXT`,
    },
    {
      version: 17,
      sql: `ALTER TABLE feedback ADD COLUMN IF NOT EXISTS draft_note TEXT`,
    },
    {
      version: 18,
      sql: `CREATE TABLE IF NOT EXISTS messaging_nodes (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL DEFAULT 'user',
        title TEXT NOT NULL DEFAULT 'New Node',
        persona_id TEXT,
        tone TEXT,
        value_props TEXT,
        phrases_to_use TEXT,
        phrases_to_avoid TEXT,
        example_notes TEXT,
        notes TEXT,
        position_x INTEGER NOT NULL DEFAULT 100,
        position_y INTEGER NOT NULL DEFAULT 100,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 19,
      sql: `CREATE TABLE IF NOT EXISTS messaging_edges (
        id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 20,
      // Repurpose type='user' → specific node types. 'global' stays as-is.
      sql: `UPDATE messaging_nodes SET type = 'tone' WHERE type = 'user'`,
    },
    { version: 21, sql: `ALTER TABLE messaging_nodes ADD COLUMN owner_email TEXT` },
    { version: 22, sql: `ALTER TABLE messaging_edges ADD COLUMN owner_email TEXT` },
    { version: 23, sql: `CREATE INDEX IF NOT EXISTS prospects_owner_created ON prospects(owner_email, created_at DESC)` },
    { version: 24, sql: `CREATE INDEX IF NOT EXISTS prospects_owner_status ON prospects(owner_email, status)` },
    { version: 25, sql: `CREATE INDEX IF NOT EXISTS messaging_nodes_owner_type ON messaging_nodes(owner_email, type)` },
    { version: 26, sql: `CREATE INDEX IF NOT EXISTS messaging_edges_source_owner ON messaging_edges(source_id, owner_email)` },
    { version: 27, sql: `CREATE INDEX IF NOT EXISTS messaging_edges_owner ON messaging_edges(owner_email)` },
    { version: 28, sql: `CREATE INDEX IF NOT EXISTS send_history_owner_url ON send_history(owner_email, profile_url)` },
    { version: 29, sql: `CREATE INDEX IF NOT EXISTS api_tokens_token ON api_tokens(token)` },
    { version: 30, sql: `CREATE INDEX IF NOT EXISTS icp_personas_active ON icp_personas(is_active)` },
    {
      version: 31,
      sql: `CREATE TABLE IF NOT EXISTS messaging_canvases (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        template_slug TEXT,
        is_system INTEGER NOT NULL DEFAULT 0,
        owner_email TEXT,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    { version: 32, sql: `ALTER TABLE messaging_nodes ADD COLUMN canvas_id TEXT` },
    { version: 33, sql: `ALTER TABLE messaging_edges ADD COLUMN canvas_id TEXT` },
    {
      version: 34,
      sql: `CREATE INDEX IF NOT EXISTS messaging_nodes_canvas ON messaging_nodes(canvas_id)`,
    },
    {
      version: 35,
      sql: `CREATE INDEX IF NOT EXISTS messaging_edges_canvas ON messaging_edges(canvas_id)`,
    },
    { version: 36, sql: `ALTER TABLE feedback ADD COLUMN resolved_at TEXT` },
    {
      version: 37,
      sql: `CREATE TABLE IF NOT EXISTS post_engagements (
        id TEXT PRIMARY KEY,
        owner_email TEXT,
        post_url TEXT NOT NULL,
        post_title TEXT,
        engager_name TEXT NOT NULL,
        engager_company TEXT,
        engager_headline TEXT,
        engager_role TEXT,
        engager_about TEXT,
        engager_recent_activity TEXT,
        engager_profile_url TEXT NOT NULL,
        comment_text TEXT,
        xdr_owner TEXT,
        contact_owner TEXT,
        hubspot_status TEXT,
        fit_verdict TEXT,
        fit_reason TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 38,
      sql: [
        // Remove duplicate rows first (keep one per unique combo), then add the constraint.
        `DELETE FROM post_engagements WHERE id NOT IN (
          SELECT MIN(id) FROM post_engagements
          GROUP BY post_url, engager_profile_url, COALESCE(owner_email, '')
        )`,
        `CREATE UNIQUE INDEX IF NOT EXISTS idx_post_engagements_unique
          ON post_engagements (post_url, engager_profile_url, COALESCE(owner_email, ''))`,
      ].join(";\n"),
    },
    {
      version: 39,
      sql: [
        `ALTER TABLE post_engagements ADD COLUMN IF NOT EXISTS company_owner TEXT`,
        `ALTER TABLE post_engagements ADD COLUMN IF NOT EXISTS hubspot_contact_url TEXT`,
        `ALTER TABLE post_engagements ADD COLUMN IF NOT EXISTS draft_note TEXT`,
        `ALTER TABLE post_engagements ADD COLUMN IF NOT EXISTS persona_id TEXT`,
        `ALTER TABLE post_engagements ADD COLUMN IF NOT EXISTS persona_name TEXT`,
        `ALTER TABLE post_engagements ADD COLUMN IF NOT EXISTS persona_color TEXT`,
      ].join(";\n"),
    },
    {
      version: 40,
      sql: `CREATE TABLE IF NOT EXISTS workspace_user_roles (
        email TEXT PRIMARY KEY,
        role TEXT NOT NULL DEFAULT 'none',
        hubspot_account_id TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 41,
      sql: `CREATE TABLE IF NOT EXISTS workspace_app_access (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        app TEXT NOT NULL,
        granted_by TEXT,
        granted_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 42,
      name: "messaging-nodes-hubspot-contact-id",
      sql: `ALTER TABLE messaging_nodes ADD COLUMN IF NOT EXISTS hubspot_contact_id TEXT`,
    },
    {
      version: 43,
      name: "rate-limit-counters-table",
      sql: `CREATE TABLE IF NOT EXISTS rate_limit_counters (
        id TEXT PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        window_start TEXT NOT NULL
      )`,
    },
    {
      version: 44,
      name: "lead-lists-table",
      sql: `CREATE TABLE IF NOT EXISTS lead_lists (
        id TEXT PRIMARY KEY,
        owner_email TEXT,
        name TEXT NOT NULL,
        sales_nav_list_url TEXT,
        total_count INTEGER NOT NULL DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 45,
      name: "lead-list-items-table",
      sql: `CREATE TABLE IF NOT EXISTS lead_list_items (
        id TEXT PRIMARY KEY,
        list_id TEXT NOT NULL,
        name TEXT,
        headline TEXT,
        company TEXT,
        location TEXT,
        profile_url TEXT,
        sales_nav_lead_url TEXT,
        status TEXT NOT NULL DEFAULT 'pending',
        position INTEGER NOT NULL,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 46,
      name: "lead-list-items-list-id-index",
      sql: `CREATE INDEX IF NOT EXISTS lead_list_items_list_id ON lead_list_items(list_id)`,
    },
    {
      version: 47,
      name: "lead-lists-owner-email-index",
      sql: `CREATE INDEX IF NOT EXISTS lead_lists_owner_email ON lead_lists(owner_email)`,
    },
    {
      version: 48,
      name: "lead-list-items-enrichment-status",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'idle'`,
    },
    {
      version: 49,
      name: "lead-list-items-enriched-email",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enriched_email TEXT`,
    },
    {
      version: 50,
      name: "lead-list-items-enriched-title",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enriched_title TEXT`,
    },
    {
      version: 51,
      name: "lead-list-items-enriched-linkedin-url",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enriched_linkedin_url TEXT`,
    },
    {
      version: 52,
      name: "lead-list-items-enriched-company-industry",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enriched_company_industry TEXT`,
    },
    {
      version: 53,
      name: "lead-list-items-enriched-company-size",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enriched_company_size INTEGER`,
    },
    {
      version: 54,
      name: "lead-list-items-enriched-at",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enriched_at TEXT`,
    },
    {
      version: 55,
      name: "prospects-enrichment-status",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enrichment_status TEXT NOT NULL DEFAULT 'idle'`,
    },
    {
      version: 56,
      name: "prospects-enriched-email",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enriched_email TEXT`,
    },
    {
      version: 57,
      name: "prospects-enriched-title",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enriched_title TEXT`,
    },
    {
      version: 58,
      name: "prospects-enriched-linkedin-url",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enriched_linkedin_url TEXT`,
    },
    {
      version: 59,
      name: "prospects-enriched-company-industry",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enriched_company_industry TEXT`,
    },
    {
      version: 60,
      name: "prospects-enriched-company-size",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enriched_company_size INTEGER`,
    },
    {
      version: 61,
      name: "prospects-enriched-at",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enriched_at TEXT`,
    },
    {
      version: 62,
      name: "lead-list-items-enrichment-error",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enrichment_error TEXT`,
    },
    {
      version: 63,
      name: "prospects-enrichment-error",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enrichment_error TEXT`,
    },
    {
      version: 64,
      name: "lead-list-items-enriched-phone",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS enriched_phone TEXT`,
    },
    {
      version: 65,
      name: "prospects-enriched-phone",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS enriched_phone TEXT`,
    },
    {
      version: 66,
      name: "lead-list-items-persona-id",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS persona_id TEXT`,
    },
    {
      version: 67,
      name: "lead-list-items-persona-name",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS persona_name TEXT`,
    },
    {
      version: 68,
      name: "lead-list-items-persona-color",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS persona_color TEXT`,
    },
    {
      version: 69,
      name: "lead-lists-description",
      sql: `ALTER TABLE lead_lists ADD COLUMN IF NOT EXISTS description TEXT`,
    },
    {
      version: 70,
      name: "lead-list-items-phone-reveal-status",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS phone_reveal_status TEXT`,
    },
    {
      version: 71,
      name: "lead-list-items-phone-reveal-request-id",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS phone_reveal_request_id TEXT`,
    },
    {
      version: 72,
      name: "lead-list-items-phone-reveal-requested-at",
      sql: `ALTER TABLE lead_list_items ADD COLUMN IF NOT EXISTS phone_reveal_requested_at TEXT`,
    },
    {
      version: 73,
      name: "prospects-phone-reveal-status",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS phone_reveal_status TEXT`,
    },
    {
      version: 74,
      name: "prospects-phone-reveal-request-id",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS phone_reveal_request_id TEXT`,
    },
    {
      version: 75,
      name: "prospects-phone-reveal-requested-at",
      sql: `ALTER TABLE prospects ADD COLUMN IF NOT EXISTS phone_reveal_requested_at TEXT`,
    },
    // Performance pass — no table in this app had a single index beyond its
    // primary key. Every one of these columns is filtered on directly in a
    // hot-path query (lead_list_items.list_id on every Lead Lists page load
    // and every enrich call; phone_reveal_request_id on every Apollo
    // phone-reveal webhook callback; owner_email on every dashboard list
    // load and every analytics groupBy; profile_url on every single
    // captured-profile check-already-contacted call). None of these were a
    // problem at low row counts, but they turn into full sequential scans
    // as each table grows with real usage — exactly the kind of slowdown
    // that shows up as "the app feels a little slower now" rather than an
    // outright error.
    {
      version: 76,
      name: "index-lead-list-items-list-id",
      sql: `CREATE INDEX IF NOT EXISTS idx_lead_list_items_list_id ON lead_list_items (list_id)`,
    },
    {
      version: 77,
      name: "index-lead-list-items-phone-reveal-request-id",
      sql: `CREATE INDEX IF NOT EXISTS idx_lead_list_items_phone_reveal_request_id ON lead_list_items (phone_reveal_request_id)`,
    },
    {
      version: 78,
      name: "index-lead-list-items-sales-nav-lead-url",
      sql: `CREATE INDEX IF NOT EXISTS idx_lead_list_items_sales_nav_lead_url ON lead_list_items (sales_nav_lead_url)`,
    },
    {
      version: 79,
      name: "index-lead-lists-owner-email",
      sql: `CREATE INDEX IF NOT EXISTS idx_lead_lists_owner_email ON lead_lists (owner_email)`,
    },
    {
      version: 80,
      name: "index-prospects-owner-email",
      sql: `CREATE INDEX IF NOT EXISTS idx_prospects_owner_email ON prospects (owner_email)`,
    },
    {
      version: 81,
      name: "index-prospects-profile-url",
      sql: `CREATE INDEX IF NOT EXISTS idx_prospects_profile_url ON prospects (profile_url)`,
    },
    {
      version: 82,
      name: "index-send-history-profile-url-owner-email",
      sql: `CREATE INDEX IF NOT EXISTS idx_send_history_profile_url_owner_email ON send_history (profile_url, owner_email)`,
    },
    {
      version: 83,
      name: "index-post-engagements-owner-email",
      sql: `CREATE INDEX IF NOT EXISTS idx_post_engagements_owner_email ON post_engagements (owner_email)`,
    },
    {
      version: 84,
      name: "index-post-engagements-post-url",
      sql: `CREATE INDEX IF NOT EXISTS idx_post_engagements_post_url ON post_engagements (post_url)`,
    },
    {
      version: 85,
      name: "index-api-tokens-token",
      sql: `CREATE INDEX IF NOT EXISTS idx_api_tokens_token ON api_tokens (token)`,
    },
  ],
  { table: "outreach_migrations" },
);
