/**
 * Build 1 tests for LinkedIn Agent.
 *
 * Covers:
 *  1. Branding     — APP_TITLE, manifest.json, Sidebar replace Agent Native logo
 *  2. Re-draft     — action file exists with correct schema; live smoke-test if server running
 *  3. Extension    — panel.js / background.js have GET_EXISTING_DRAFT and GET_DAILY_STATS handlers
 *  4. Daily limit  — workspace_settings table exists; actions exist; schema has workspaceSettings
 *  5. Uninvited UX — InvitationBanner is imported in Layout.tsx; AUTO_CREATE_DEFAULT_ORG=0 in .env
 */

import { execSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

// ─── constants ───────────────────────────────────────────────────────────────

const ROOT       = path.resolve(__dirname, "..");
const DB_PATH    = path.resolve(ROOT, "data/app.db");
const OUTREACH   = "http://127.0.0.1:8101/outreach";

// ─── helpers ─────────────────────────────────────────────────────────────────

function readFile(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf8");
}

function sql(query: string): string {
  return execSync(`sqlite3 "${DB_PATH}" ${JSON.stringify(query)}`, {
    encoding: "utf8",
  }).trim();
}

function serverRunning(): boolean {
  try {
    execSync(`curl -s --max-time 2 "${OUTREACH}/_agent-native/actions/get-draft?profileUrl=x" -o /dev/null`, {
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

async function callActionGet(name: string, params: Record<string, string> = {}) {
  const qs = new URLSearchParams(params).toString();
  const url = `${OUTREACH}/_agent-native/actions/${name}${qs ? `?${qs}` : ""}`;
  const res = await fetch(url).catch(() => null);
  if (!res) return { ok: false, status: -1, body: null };
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: json };
}

async function callAction(name: string, body: Record<string, unknown>) {
  const res = await fetch(`${OUTREACH}/_agent-native/actions/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).catch(() => null);
  if (!res) return { ok: false, status: -1, body: null };
  const json = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, body: json };
}

// ─── 1. Branding ─────────────────────────────────────────────────────────────

describe("Branding", () => {
  it("app-config.ts exports APP_TITLE = LinkedIn Agent", () => {
    const src = readFile("app/lib/app-config.ts");
    expect(src).toContain('rawAppTitle = "LinkedIn Agent"');
  });

  it("public/manifest.json has name = LinkedIn Agent", () => {
    const manifest = JSON.parse(readFile("public/manifest.json"));
    expect(manifest.name).toBe("LinkedIn Agent");
    expect(manifest.short_name).toBe("LinkedIn Agent");
  });

  it("Sidebar.tsx does not reference Agent Native SVG icons", () => {
    const src = readFile("app/components/layout/Sidebar.tsx");
    expect(src).not.toContain("agent-native-icon-light.svg");
    expect(src).not.toContain("agent-native-icon-dark.svg");
  });

  it("Sidebar.tsx contains LI badge", () => {
    const src = readFile("app/components/layout/Sidebar.tsx");
    expect(src).toContain('badge: "LI"');
  });

  it("root.tsx tracking uses builder-li app key", () => {
    const src = readFile("app/root.tsx");
    expect(src).toContain('app: "builder-li"');
  });
});

// ─── 2. Re-draft action ───────────────────────────────────────────────────────

describe("Re-draft action", () => {
  it("redraft-prospect.ts action file exists", () => {
    expect(fs.existsSync(path.resolve(ROOT, "actions/redraft-prospect.ts"))).toBe(true);
  });

  it("redraft-prospect.ts uses requiresAuth: true", () => {
    const src = readFile("actions/redraft-prospect.ts");
    expect(src).toContain("requiresAuth: true");
  });

  it("redraft-prospect.ts schema accepts id: string", () => {
    const src = readFile("actions/redraft-prospect.ts");
    expect(src).toContain("id: z.string()");
  });

  it("redraft-prospect.ts enforces ownership via owner_email check", () => {
    const src = readFile("actions/redraft-prospect.ts");
    expect(src).toContain("ownerEmail");
    expect(src).toContain("userEmail");
  });

  it("_index.tsx imports IconRefresh and calls redraft-prospect mutation", () => {
    const src = readFile("app/routes/_index.tsx");
    expect(src).toContain("IconRefresh");
    expect(src).toContain('useActionMutation("redraft-prospect")');
  });

  it("live: redraft-prospect requires auth (returns 401/403 without session)", async () => {
    if (!serverRunning()) {
      console.warn("Server not running — skipping live redraft test");
      return;
    }
    const result = await callAction("redraft-prospect", { id: "nonexistent" });
    expect([401, 403]).toContain(result.status);
  });
});

// ─── 3. Extension existing-draft & daily stats ──────────────────────────────

describe("Extension GET_EXISTING_DRAFT and GET_DAILY_STATS", () => {
  it("background.js has getExistingDraft function", () => {
    const src = readFile("extension/background.js");
    expect(src).toContain("getExistingDraft");
  });

  it("background.js handles GET_EXISTING_DRAFT message", () => {
    const src = readFile("extension/background.js");
    expect(src).toContain("GET_EXISTING_DRAFT");
  });

  it("background.js has getDailyStats function", () => {
    const src = readFile("extension/background.js");
    expect(src).toContain("getDailyStats");
  });

  it("background.js handles GET_DAILY_STATS message", () => {
    const src = readFile("extension/background.js");
    expect(src).toContain("GET_DAILY_STATS");
  });

  it("panel.js sends GET_EXISTING_DRAFT on init", () => {
    const src = readFile("extension/panel.js");
    expect(src).toContain("GET_EXISTING_DRAFT");
  });

  it("panel.js sends GET_DAILY_STATS on init", () => {
    const src = readFile("extension/panel.js");
    expect(src).toContain("GET_DAILY_STATS");
  });

  it("panel.js has renderDailyMeter function", () => {
    const src = readFile("extension/panel.js");
    expect(src).toContain("renderDailyMeter");
  });

  it("panel.js resets draftBtn text to 'Draft note' in resetPanel", () => {
    const src = readFile("extension/panel.js");
    expect(src).toContain('draftBtn.textContent = "Draft note"');
  });

  it("panel.html has daily-meter element", () => {
    const src = readFile("extension/panel.html");
    expect(src).toContain("daily-meter");
    expect(src).toContain("daily-meter-bar");
    expect(src).toContain("daily-meter-text");
  });
});

// ─── 4. Daily limit (DB + actions) ──────────────────────────────────────────

describe("Daily limit — schema and actions", () => {
  it("server/db/schema.ts exports workspaceSettings table", () => {
    const src = readFile("server/db/schema.ts");
    expect(src).toContain("workspaceSettings");
    expect(src).toContain("workspace_settings");
  });

  it("get-daily-stats.ts exists and returns capturedToday + limit", () => {
    const src = readFile("actions/get-daily-stats.ts");
    expect(src).toContain("capturedToday");
    expect(src).toContain("limit");
    expect(src).toContain('http: { method: "GET" }');
  });

  it("set-daily-limit.ts exists and calls requireAdmin", () => {
    const src = readFile("actions/set-daily-limit.ts");
    expect(src).toContain("requireAdmin");
    expect(src).toContain("daily_outreach_limit");
  });

  it("settings.tsx contains DailyLimitCard component", () => {
    const src = readFile("app/routes/settings.tsx");
    expect(src).toContain("DailyLimitCard");
    expect(src).toContain("set-daily-limit");
  });

  it("DB: workspace_settings table exists (local SQLite only)", () => {
    if (!fs.existsSync(DB_PATH)) {
      console.warn("No local DB — skipping DB check");
      return;
    }
    const tables = sql(".tables");
    expect(tables).toContain("workspace_settings");
  });

  it("live: get-daily-stats returns ok:true with capturedToday and limit fields", async () => {
    if (!serverRunning()) {
      console.warn("Server not running — skipping live daily-stats test");
      return;
    }
    const result = await callActionGet("get-daily-stats");
    expect(result.ok).toBe(true);
    expect(result.body).toHaveProperty("capturedToday");
    expect(result.body).toHaveProperty("limit");
  });
});

// ─── 5. Uninvited user flow ──────────────────────────────────────────────────

describe("Uninvited user flow", () => {
  it("Layout.tsx imports InvitationBanner from @agent-native/core/client/org", () => {
    const src = readFile("app/components/layout/Layout.tsx");
    expect(src).toContain("InvitationBanner");
    expect(src).toContain("@agent-native/core/client/org");
  });

  it("Layout.tsx renders <InvitationBanner /> inside <main>", () => {
    const src = readFile("app/components/layout/Layout.tsx");
    expect(src).toContain("<InvitationBanner />");
  });

  it(".env has AUTO_CREATE_DEFAULT_ORG=0", () => {
    const envPath = path.resolve(ROOT, "../../.env");
    if (!fs.existsSync(envPath)) {
      console.warn("Root .env not found — skipping");
      return;
    }
    const env = fs.readFileSync(envPath, "utf8");
    expect(env).toContain("AUTO_CREATE_DEFAULT_ORG=0");
  });
});
