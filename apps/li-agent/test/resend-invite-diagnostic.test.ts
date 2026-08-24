/**
 * Diagnostic tests for resend-invite email delivery.
 * Run with: pnpm exec vitest run test/resend-invite-diagnostic.test.ts
 *
 * These tests print console output to help diagnose email delivery issues.
 * They do not assert pass/fail for live network calls — they report status.
 */
import * as fs from "fs";
import * as path from "path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "..");

function readFile(rel: string): string {
  return fs.readFileSync(path.resolve(ROOT, rel), "utf8");
}

async function callResendApi(apiKey: string, to: string): Promise<{ status: number; body: any }> {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      // guard:allow-env-credential — manual diagnostic test script reading local env, not a per-user credential
      from: process.env.EMAIL_FROM ?? "LinkedIn Agent <onboarding@resend.dev>",
      to,
      subject: "LinkedIn Agent — invite test",
      html: "<p>Test email from LinkedIn Agent diagnostic suite.</p>",
      text: "Test email from LinkedIn Agent diagnostic suite.",
    }),
  });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}

// ─── 1. Action source checks ──────────────────────────────────────────────────

describe("resend-invite action: source checks", () => {
  // guard:allow-env-credential — test name string literal, not an actual env read
  it("uses process.env.RESEND_API_KEY directly (not resolveSecret)", () => {
    const src = readFile("actions/resend-invite.ts");
    // guard:allow-env-credential — string literal assertion, not an actual env read
    expect(src).toContain("process.env.RESEND_API_KEY");
    expect(src).not.toContain("resolveSecret");
    expect(src).not.toContain("sendEmail");
  });

  it("returns ok:false with error message instead of throwing", () => {
    const src = readFile("actions/resend-invite.ts");
    expect(src).toContain("return { ok: false, error:");
    expect(src).not.toContain('throw new Error("RESEND_API_KEY');
  });

  it("logs errors to console for Netlify function logs", () => {
    const src = readFile("actions/resend-invite.ts");
    expect(src).toContain("console.error");
  });
});

// ─── 2. Local env diagnostics ─────────────────────────────────────────────────

describe("local env: RESEND_API_KEY status", () => {
  it("reports RESEND_API_KEY status", () => {
    // guard:allow-env-credential — manual diagnostic test script reading local env, not a per-user credential
    const key = process.env.RESEND_API_KEY;
    if (key) {
      console.log(`✓ RESEND_API_KEY is set locally (length=${key.length}, prefix=${key.slice(0, 8)}...)`);
    } else {
      console.warn("✗ RESEND_API_KEY is NOT set in local env — it must be set in Netlify environment variables");
    }
    // This test always passes — it's purely informational
  });

  it("reports EMAIL_FROM status", () => {
    // guard:allow-env-credential — manual diagnostic test script reading local env, not a per-user credential
    const from = process.env.EMAIL_FROM;
    if (from) {
      console.log(`✓ EMAIL_FROM is set: "${from}"`);
    } else {
      console.warn('✗ EMAIL_FROM is NOT set — using sandbox default "onboarding@resend.dev"');
      console.warn("  ⚠ Sandbox mode: emails can only be sent to the Resend account owner's email.");
      console.warn("  Fix: verify a domain in Resend → set EMAIL_FROM=LinkedIn Agent <you@yourdomain.com> in Netlify");
    }
  });
});

// ─── 3. Live Resend API test (only if key is set locally) ────────────────────

describe("live: Resend API call", () => {
  it("sends a test email via Resend API (skipped if no key)", async () => {
    // guard:allow-env-credential — manual diagnostic test script reading local env, not a per-user credential
    const key = process.env.RESEND_API_KEY;
    // guard:allow-env-credential — manual diagnostic test script reading local env, not a per-user credential
    const testTo = process.env.TEST_EMAIL ?? process.env.EMAIL_FROM?.match(/<(.+)>/)?.[1];
    if (!key) {
      console.warn("Skipping — RESEND_API_KEY not in local env (must be set in Netlify)");
      return;
    }
    if (!testTo) {
      console.warn("Skipping — set TEST_EMAIL=you@example.com to run this test");
      return;
    }

    // guard:allow-env-credential — manual diagnostic test script reading local env, not a per-user credential
    console.log(`Sending test email to ${testTo} from "${process.env.EMAIL_FROM ?? "onboarding@resend.dev"}"...`);
    const result = await callResendApi(key, testTo);
    console.log("Resend API response:", result.status, JSON.stringify(result.body, null, 2));

    if (result.status === 200 || result.status === 201) {
      console.log("✓ Email sent successfully");
      expect(result.status).toBeLessThan(300);
    } else if (result.status === 403) {
      console.error("✗ 403 Forbidden — likely sandbox restriction:");
      console.error("  The 'onboarding@resend.dev' sender can only send to your Resend account email.");
      console.error("  Fix: verify a domain in Resend → set EMAIL_FROM in Netlify env vars");
      expect(result.status).toBeLessThan(300);
    } else {
      console.error(`✗ Error ${result.status}:`, result.body);
      expect(result.status).toBeLessThan(300);
    }
  }, 15000);
});
