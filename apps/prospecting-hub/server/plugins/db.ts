import { runMigrations } from "@agent-native/core/db";

export default runMigrations(
  [
    {
      version: 1,
      name: "contacts-table",
      sql: `CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        title TEXT,
        company TEXT,
        email TEXT,
        phone TEXT,
        linkedin_url TEXT,
        hubspot_url TEXT,
        persona_match_score INTEGER,
        company_fit_score INTEGER,
        score_reasoning TEXT,
        source TEXT NOT NULL,
        external_id TEXT,
        persona_id TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        synced_at TEXT DEFAULT (datetime('now')),
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 2,
      name: "segments-table",
      sql: `CREATE TABLE IF NOT EXISTS segments (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        assigned_to_email TEXT,
        visibility TEXT NOT NULL DEFAULT 'private',
        persona_id TEXT,
        filters TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        last_refreshed_at TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 3,
      name: "segment-contacts-table",
      sql: `CREATE TABLE IF NOT EXISTS segment_contacts (
        id TEXT PRIMARY KEY,
        segment_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        added_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 4,
      name: "personas-table",
      sql: `CREATE TABLE IF NOT EXISTS personas (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        criteria TEXT,
        source_doc_url TEXT,
        owner_email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 5,
      name: "sub-personas-table",
      sql: `CREATE TABLE IF NOT EXISTS sub_personas (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        name TEXT NOT NULL,
        criteria TEXT,
        owner_email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 6,
      name: "contact-sub-personas-table",
      sql: `CREATE TABLE IF NOT EXISTS contact_sub_personas (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        sub_persona_id TEXT NOT NULL
      )`,
    },
    {
      version: 7,
      name: "analytics-events-table",
      sql: `CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        user_email TEXT NOT NULL,
        event_type TEXT NOT NULL,
        metadata TEXT,
        timestamp TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 8,
      name: "sync-records-table",
      sql: `CREATE TABLE IF NOT EXISTS sync_records (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        records_pulled INTEGER,
        status TEXT NOT NULL,
        error TEXT
      )`,
    },
    {
      version: 9,
      name: "personas-color-column",
      sql: `ALTER TABLE personas ADD COLUMN color TEXT`,
    },
    {
      version: 10,
      name: "sourcing-rules-table",
      sql: `CREATE TABLE IF NOT EXISTS sourcing_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        persona_id TEXT NOT NULL,
        sub_persona_id TEXT,
        company_allow_list TEXT,
        company_deny_list TEXT,
        desired_volume INTEGER NOT NULL DEFAULT 20,
        ready_by_time TEXT NOT NULL,
        lead_hours INTEGER NOT NULL DEFAULT 3,
        segment_id TEXT NOT NULL,
        job_resource_path TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 11,
      name: "library-docs-table",
      sql: `CREATE TABLE IF NOT EXISTS library_docs (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        tags TEXT,
        content TEXT NOT NULL,
        linked_persona_id TEXT,
        linked_icp_id TEXT,
        source_file_name TEXT,
        owner_email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 12,
      name: "icps-table",
      sql: `CREATE TABLE IF NOT EXISTS icps (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        product TEXT,
        color TEXT,
        criteria TEXT,
        source_doc_url TEXT,
        owner_email TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 13,
      name: "sourcing-rules-icp-column",
      sql: `ALTER TABLE sourcing_rules ADD COLUMN icp_id TEXT`,
    },
    {
      version: 14,
      name: "contacts-engagement-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN engagement_score INTEGER`,
    },
    {
      version: 15,
      name: "contacts-overall-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN overall_score INTEGER`,
    },
    {
      version: 16,
      name: "sync-records-metadata-column",
      sql: `ALTER TABLE sync_records ADD COLUMN metadata TEXT`,
    },
    {
      version: 17,
      name: "contacts-country-column",
      sql: `ALTER TABLE contacts ADD COLUMN country TEXT`,
    },
    {
      version: 18,
      name: "contacts-employees-column",
      sql: `ALTER TABLE contacts ADD COLUMN employees INTEGER`,
    },
    {
      version: 19,
      name: "contacts-hubspot-ql-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN hubspot_ql_score INTEGER`,
    },
    {
      version: 20,
      name: "contacts-commonroom-intent-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN commonroom_intent_score INTEGER`,
    },
    {
      version: 21,
      name: "contacts-commonroom-company-fit-score-column",
      sql: `ALTER TABLE contacts ADD COLUMN commonroom_company_fit_score INTEGER`,
    },
    {
      version: 22,
      name: "focus-accounts-table",
      sql: `CREATE TABLE IF NOT EXISTS focus_accounts (
        id TEXT PRIMARY KEY,
        owner_email TEXT NOT NULL,
        company_name TEXT NOT NULL,
        company_domain TEXT,
        tier TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 23,
      name: "contacts-draft-email-columns",
      sql: `ALTER TABLE contacts ADD COLUMN draft_email_subject TEXT; ALTER TABLE contacts ADD COLUMN draft_email_body TEXT`,
    },
    {
      version: 24,
      name: "contacts-draft-linkedin-and-generated-at-columns",
      sql: `ALTER TABLE contacts ADD COLUMN draft_linkedin_message TEXT; ALTER TABLE contacts ADD COLUMN draft_generated_at TEXT`,
    },
    {
      version: 25,
      name: "sourcing-rules-interval-hours-column",
      sql: `ALTER TABLE sourcing_rules ADD COLUMN interval_hours INTEGER`,
    },
    {
      version: 26,
      name: "persona-documents-table",
      sql: `CREATE TABLE IF NOT EXISTS persona_documents (
        id TEXT PRIMARY KEY,
        persona_id TEXT NOT NULL,
        file_name TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 27,
      name: "sync-records-sourcing-rule-id-column",
      sql: `ALTER TABLE sync_records ADD COLUMN sourcing_rule_id TEXT`,
    },
    {
      version: 28,
      name: "sourcing-rule-run-targets-table",
      sql: `CREATE TABLE IF NOT EXISTS sourcing_rule_run_targets (
        id TEXT PRIMARY KEY,
        sync_record_id TEXT NOT NULL,
        contact_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        error TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      )`,
    },
    {
      version: 29,
      name: "sync-records-running-per-rule-unique-index",
      // Database-level guarantee that at most one sync_records row can be
      // status:"running" for a given sourcing_rule_id at any time — closes a
      // real TOCTOU race in run-sourcing-rule-pipeline.ts's "attach to an
      // existing running run, or start fresh" logic (a fresh-start check-then-
      // insert with no lock between the two, which two concurrent
      // no-syncRecordId calls for the same rule could both pass before either
      // INSERTs). A PARTIAL unique index (only applies to rows where
      // status = 'running') rather than a plain unique column, since every
      // OTHER sync source (sync-hubspot.ts, sync-commonroom.ts,
      // import-prospects-to-segment.ts) writes sourcing_rule_id: NULL and
      // must remain free to have any number of non-"running" (or NULL-ruleId)
      // rows — NULLs are never considered equal to each other under a unique
      // index in either SQLite or Postgres, so those writers are unaffected
      // regardless. Verified this exact syntax is valid, portable DDL on both
      // SQLite (partial indexes supported since 3.8.0) and Postgres (partial
      // indexes are a longstanding core feature) — no dialect gating needed.
      //
      // CLEANUP STATEMENT FIRST (fix round 2): production can already have
      // 2+ "running" rows sharing the same sourcing_rule_id — that's
      // EXACTLY the zombie state the pre-fix-round-1 scheduled-job bug was
      // producing on every fire, before the job-prompt loop fix existed.
      // Creating a unique index over already-violating data fails outright;
      // on this app's migration runner that failure is caught and swallowed
      // (never crashes the process), the failed migration is never recorded
      // as applied, and — because migrations apply in strict list order —
      // EVERY migration after this one would then silently never apply
      // either, forever, with no loud failure anywhere. So this cleans up
      // any pre-existing duplicates FIRST, in the same migration entry,
      // before the index creation even runs: for every sourcing_rule_id with
      // more than one "running" row, keep only the one with the latest
      // started_at (ties broken by id, so exactly one survives even if two
      // rows share an identical started_at) and mark every other one
      // "failed" with a clear reason. Plain correlated EXISTS subquery — no
      // window functions, no CTEs, no dialect-specific syntax — verified
      // this exact shape is valid, portable SQL on both SQLite and Postgres.
      // completed_at is set to each losing row's own started_at rather than
      // "now" specifically to avoid needing any current-timestamp function
      // call at all (datetime('now') is SQLite-only, NOW()/CURRENT_TIMESTAMP
      // differ enough across drivers not to risk it in raw migration SQL).
      sql: `UPDATE sync_records
        SET status = 'failed',
            completed_at = started_at,
            error = 'Superseded by migration cleanup — duplicate running row detected for this rule'
        WHERE status = 'running'
          AND sourcing_rule_id IS NOT NULL
          AND EXISTS (
            SELECT 1 FROM sync_records s2
            WHERE s2.sourcing_rule_id = sync_records.sourcing_rule_id
              AND s2.status = 'running'
              AND (s2.started_at > sync_records.started_at
                   OR (s2.started_at = sync_records.started_at AND s2.id > sync_records.id))
          );
        CREATE UNIQUE INDEX IF NOT EXISTS sync_records_running_per_rule_idx ON sync_records(sourcing_rule_id) WHERE status = 'running'`,
    },
    {
      version: 30,
      name: "sourcing-rule-run-targets-claimed-at-and-unique-index",
      // claimed_at: nullable timestamp, set only while a row is
      // status = "claimed" — lets runScoringChunk (run-sourcing-rule-
      // pipeline.ts) detect and reclaim a row whose claiming invocation
      // crashed mid-chunk before reaching a terminal scored/errored state
      // (see that function's claim-staleness reclaim step for the exact
      // threshold/reasoning). Also adds a UNIQUE(sync_record_id, contact_id)
      // index — cheap, low-cost hardening against the DISCLOSED (accepted,
      // non-blocking) residual search-phase race noted in the fix-round-1
      // report: two concurrent invocations both resolving the same match
      // for the same run could otherwise both insert a queue row for the
      // same (sync_record_id, contact_id) pair. This neutralizes the
      // duplicate-QUEUE-ROW symptom of that race cheaply, without needing
      // to solve the race's actual root cause (resolveContact's dedup,
      // which spans multiple tables/conditions, not a single status flip).
      // Same defensive-cleanup-before-index pattern as v29 above, for the
      // same reason: this table already exists (since v28) and — however
      // unlikely, given it's the same young feature as v29's own bug — could
      // already hold duplicate (sync_record_id, contact_id) pairs from a run
      // that hit the disclosed race before this index existed. Keeps
      // whichever duplicate row has the lowest id (arbitrary but
      // deterministic — these are ephemeral work-queue rows, not a
      // permanent record, so which literal row id survives doesn't matter).
      sql: `ALTER TABLE sourcing_rule_run_targets ADD COLUMN claimed_at TEXT;
        DELETE FROM sourcing_rule_run_targets
        WHERE id NOT IN (
          SELECT MIN(id) FROM sourcing_rule_run_targets GROUP BY sync_record_id, contact_id
        );
        CREATE UNIQUE INDEX IF NOT EXISTS sourcing_rule_run_targets_sync_contact_idx ON sourcing_rule_run_targets(sync_record_id, contact_id)`,
    },
    {
      version: 31,
      name: "sourcing-rules-manual-prospector-filters",
      // Manual overrides for the two auto-derived (LLM-guessed) search
      // parameters, plus two purely-additive filters CommonRoom's own
      // Prospector search already supports but this app never exposed —
      // lets an XDR go as narrow or as broad as they want instead of being
      // stuck with whatever a single LLM call inferred from the persona doc.
      // manual_title_keywords/manual_seniorities: JSON string arrays,
      // nullable — when set (non-empty), REPLACE the corresponding
      // LLM-derived value in run-sourcing-rule-pipeline.ts's
      // startFreshAndSearch; when unset, today's auto-derivation behavior is
      // completely unchanged. min_linkedin_followers/previous_company_name
      // are always additive narrowing filters with no auto-derived
      // equivalent.
      sql: `ALTER TABLE sourcing_rules ADD COLUMN manual_title_keywords TEXT;
        ALTER TABLE sourcing_rules ADD COLUMN manual_seniorities TEXT;
        ALTER TABLE sourcing_rules ADD COLUMN min_linkedin_followers INTEGER;
        ALTER TABLE sourcing_rules ADD COLUMN previous_company_name TEXT`,
    },
    {
      version: 32,
      name: "contacts-hubspot-breeze-fit-score-column",
      // HubSpot Breeze AI's own "Company Fit Score - Breeze" contact
      // property (live range 0-20, normalized to 0-100 at sync time in
      // sync-hubspot.ts) — a real external fit signal that now takes
      // precedence over both the AI-judged and deterministic
      // country/employees companyFitScore in score-contact.ts.
      sql: `ALTER TABLE contacts ADD COLUMN hubspot_breeze_fit_score INTEGER`,
    },
    {
      version: 33,
      name: "contacts-external-id-source-and-email-index",
      // run-sourcing-rule-pipeline.ts's resolveContact() now runs on EVERY
      // Prospector match immediately as pages arrive (not once at the end
      // over a small accumulated batch) — its first, most-hit query is
      // `WHERE external_id = ? AND source = ?`, an unindexed full table scan
      // until now. Once a rule's candidate pool is mostly already-known,
      // this query runs for every already-known match encountered while
      // paging further to find genuinely new ones — live-confirmed: this
      // combination is what caused a real "took too long and timed out"
      // platform-level timeout right after that per-page-resolve change
      // shipped. Also indexes LOWER(email) for the cross-source dedup
      // query's email-match branch (its LIKE-based linkedin branch can't
      // use a plain index either way — leading wildcard).
      sql: `CREATE INDEX IF NOT EXISTS contacts_external_id_source_idx ON contacts(external_id, source);
        CREATE INDEX IF NOT EXISTS contacts_email_lower_idx ON contacts(LOWER(email))`,
    },
    {
      version: 34,
      name: "marketing-rules-table-and-lifecycle-stage",
      // Marketing lists: a new HubSpot-lifecycle-stage-driven rule kind
      // alongside sourcing_rules' CommonRoom-Prospector rules (renamed
      // "Prospected" in the UI) — see run-marketing-rule-pipeline.ts. Mirrors
      // sourcing_rules' shape but drops every Prospector-only field (title/
      // seniority/LinkedIn-follower/previous-company/ICP/desired-volume) and
      // adds lifecycle_stages (JSON string array, e.g. ["RAW","MEL","QL"]) —
      // there's no Prospector-side analog for that filter.
      // sync_records.marketing_rule_id mirrors the existing sourcing_rule_id
      // column exactly (plain nullable text, no FK — this app's convention):
      // exactly one of the two is set per rule-scoped run, both null for
      // every non-rule-scoped writer. sourcing_rule_run_targets needs NO
      // change — it was already rule-agnostic (only sync_record_id/
      // contact_id), so it's shared as-is by both pipelines' scoring queues.
      // contacts.lifecycle_stage is populated by both the new pipeline and
      // sync-hubspot.ts, so a HubSpot contact shows the same stage regardless
      // of which path synced it.
      sql: `CREATE TABLE IF NOT EXISTS marketing_rules (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        persona_id TEXT NOT NULL,
        lifecycle_stages TEXT,
        company_allow_list TEXT,
        company_deny_list TEXT,
        interval_hours INTEGER,
        segment_id TEXT NOT NULL,
        job_resource_path TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      );
        ALTER TABLE sync_records ADD COLUMN marketing_rule_id TEXT;
        ALTER TABLE contacts ADD COLUMN lifecycle_stage TEXT`,
    },
    {
      version: 35,
      name: "contacts-apollo-enrichment-columns",
      // On-demand Apollo.io enrichment ("Enrich with Apollo" button,
      // actions/enrich-contact-with-apollo.ts) — apollo_company_fit_score/
      // apollo_intent_score join blendFitAndIntent() as two more independent
      // Fit/Intent signals (score-contact.ts), mirroring
      // commonroom_company_fit_score/commonroom_intent_score's existing role
      // exactly, rather than overriding the existing company_fit_score
      // precedence chain. The rest are display-only fields captured at
      // enrichment time — apollo_enrichment_json holds the richer,
      // less-structured payload (employment history, technologies, funding
      // events) rather than a column each.
      sql: `ALTER TABLE contacts ADD COLUMN apollo_company_fit_score INTEGER;
        ALTER TABLE contacts ADD COLUMN apollo_intent_score INTEGER;
        ALTER TABLE contacts ADD COLUMN apollo_seniority TEXT;
        ALTER TABLE contacts ADD COLUMN apollo_title TEXT;
        ALTER TABLE contacts ADD COLUMN apollo_email_status TEXT;
        ALTER TABLE contacts ADD COLUMN apollo_industry TEXT;
        ALTER TABLE contacts ADD COLUMN apollo_employee_count INTEGER;
        ALTER TABLE contacts ADD COLUMN apollo_funding_stage TEXT;
        ALTER TABLE contacts ADD COLUMN apollo_total_funding INTEGER;
        ALTER TABLE contacts ADD COLUMN apollo_enrichment_json TEXT;
        ALTER TABLE contacts ADD COLUMN apollo_enriched_at TEXT`,
    },
    {
      version: 36,
      name: "prospect-pull-plans-tables",
      // Composition rules: "N prospects every interval, split by persona
      // percentage" -- see schema.ts's own comment on prospectPullPlans for
      // the full design. contacts.source's "linkedin" value needs no
      // migration of its own (see schema.ts) -- that column has always been
      // plain TEXT with no DB-level CHECK constraint.
      sql: `CREATE TABLE IF NOT EXISTS prospect_pull_plans (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        owner_email TEXT NOT NULL,
        total_volume INTEGER NOT NULL,
        interval_hours INTEGER NOT NULL,
        persona_mix TEXT NOT NULL,
        sourcing_rule_ids TEXT NOT NULL,
        marketing_rule_ids TEXT,
        last_reconciled_at TEXT,
        job_resource_path TEXT,
        status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT DEFAULT (datetime('now'))
      );
        CREATE TABLE IF NOT EXISTS prospect_pull_plan_runs (
        id TEXT PRIMARY KEY,
        plan_id TEXT NOT NULL,
        started_at TEXT DEFAULT (datetime('now')),
        completed_at TEXT,
        status TEXT NOT NULL DEFAULT 'success',
        metadata TEXT,
        error TEXT
      )`,
    },
    {
      version: 37,
      name: "personas-li-agent-persona-id-column",
      // Explicit cross-app persona link, set manually per persona -- see
      // schema.ts's own comment on personas.liAgentPersonaId.
      sql: `ALTER TABLE personas ADD COLUMN li_agent_persona_id TEXT`,
    },
    {
      version: 38,
      name: "sourcing-marketing-rules-company-owner-columns",
      // Live HubSpot-owner-scoped company lists -- see schema.ts's own
      // comment on sourcingRules.companyAllowListOwnerId.
      sql: `
        ALTER TABLE sourcing_rules ADD COLUMN company_allow_list_owner_id TEXT;
        ALTER TABLE sourcing_rules ADD COLUMN company_deny_list_owner_id TEXT;
        ALTER TABLE marketing_rules ADD COLUMN company_allow_list_owner_id TEXT;
        ALTER TABLE marketing_rules ADD COLUMN company_deny_list_owner_id TEXT`,
    },
    // HubSpot workflow enrollment for pull-plan-sourced contacts -- see
    // schema.ts's own comments on contacts.hubspotContactId and
    // prospectPullPlans.autoEnrollHubspotWorkflow. (These columns briefly
    // went unused for one deploy cycle while the exact mechanism was worked
    // out with Fred -- CommonRoom's OWN "Workflows" automation feature was
    // tried and rejected, since it isn't API-drivable and moves the
    // automation logic outside this app; the real answer is a minimal
    // HubSpot contact create + the existing HubSpot workflow's own
    // "manually triggered" enrollment, which the app calls directly.)
    {
      version: 39,
      name: "contacts-hubspot-workflow-enrollment-columns",
      sql: `
        ALTER TABLE contacts ADD COLUMN hubspot_contact_id TEXT;
        ALTER TABLE contacts ADD COLUMN hubspot_workflow_enrolled_at TEXT;
        ALTER TABLE contacts ADD COLUMN hubspot_enroll_error TEXT`,
    },
    {
      version: 40,
      name: "prospect-pull-plans-auto-enroll-hubspot-workflow-column",
      sql: `ALTER TABLE prospect_pull_plans ADD COLUMN auto_enroll_hubspot_workflow INTEGER NOT NULL DEFAULT 0`,
    },
  ],
  { table: "prospecting_hub_migrations" },
);
