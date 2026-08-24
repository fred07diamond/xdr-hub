import { defineAction } from "@agent-native/core";
import { table, text, eq, sql, and } from "@agent-native/core/db/schema";
import { getAppProductionUrl } from "@agent-native/core/server";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { requireAdmin } from "../server/helpers/require-admin.js";

const orgInvitations = table("org_invitations", {
  id: text("id").primaryKey(),
  orgId: text("org_id").notNull(),
  email: text("email").notNull(),
  invitedBy: text("invited_by"),
  status: text("status"),
  role: text("role"),
});

export default defineAction({
  description: "Resend a pending invitation email to a user. Admin only.",
  schema: z.object({ email: z.string().email() }),
  run: async ({ email }, ctx) => {
    await requireAdmin(ctx);
    if (!ctx?.orgId) return { ok: false, error: "No active organization" };

    const db = getDb();
    const rows = await db
      .select({ id: orgInvitations.id, email: orgInvitations.email })
      .from(orgInvitations)
      .where(
        and(
          eq(orgInvitations.orgId, ctx.orgId),
          sql`lower(${orgInvitations.email}) = lower(${email})`,
          eq(orgInvitations.status, "pending"),
        ),
      )
      .limit(1);

    if (!rows[0]) return { ok: false, error: `No pending invitation found for ${email}` };

    const appUrl = getAppProductionUrl();
    const inviter = ctx.userEmail ?? "your team";

    // guard:allow-env-credential — this workspace's own Resend account key, not a per-user credential
    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      console.error("[resend-invite] RESEND_API_KEY not set in environment");
      return { ok: false, error: "RESEND_API_KEY is not configured — add it in Netlify environment variables" };
    }

    // guard:allow-env-credential — single-workspace deployment config (the sender address), not a per-user credential
    const from = process.env.EMAIL_FROM ?? "LinkedIn Agent <onboarding@resend.dev>";

    const emailRes = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: rows[0].email,
        subject: "You're invited to LinkedIn Agent",
        html: buildInviteHtml({ invitee: rows[0].email, inviter, appUrl }),
        text: `${inviter} has invited you to join LinkedIn Agent. Sign in to accept: ${appUrl}`,
      }),
    });

    if (!emailRes.ok) {
      const errorBody = await emailRes.text().catch(() => "");
      console.error(`[resend-invite] Resend API error ${emailRes.status}: ${errorBody}`);
      return { ok: false, error: `Resend API error (${emailRes.status}): ${errorBody}` };
    }

    return { ok: true };
  },
});

function buildInviteHtml({ invitee, inviter, appUrl }: { invitee: string; inviter: string; appUrl: string }) {
  return `<!DOCTYPE html>
<html>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8f9fa;margin:0;padding:40px 20px;">
  <div style="max-width:480px;margin:0 auto;background:#fff;border-radius:12px;padding:40px;box-shadow:0 1px 4px rgba(0,0,0,0.08);">
    <div style="margin-bottom:28px;">
      <span style="background:#0a66c2;color:#fff;font-size:13px;font-weight:900;letter-spacing:-0.02em;padding:4px 8px;border-radius:4px;">XDR</span>
    </div>
    <h1 style="font-size:22px;font-weight:600;color:#111;margin:0 0 12px;">You're invited to LinkedIn Agent</h1>
    <p style="color:#555;font-size:15px;line-height:1.5;margin:0 0 24px;">
      <strong>${inviter}</strong> has invited you to join LinkedIn Agent — an AI-powered LinkedIn outreach cockpit that scores prospects against your ICP and drafts personalized connection notes.
    </p>
    <a href="${appUrl}" style="display:inline-block;background:#0a66c2;color:#fff;text-decoration:none;font-size:15px;font-weight:600;padding:12px 28px;border-radius:8px;margin-bottom:32px;">
      Accept Invitation →
    </a>
    <div style="border-top:1px solid #eee;padding-top:20px;color:#888;font-size:13px;line-height:1.6;">
      <p style="margin:0 0 8px;color:#333;font-weight:600;">Getting started</p>
      <ol style="margin:0;padding-left:20px;color:#666;">
        <li>Click the button above and sign in with Google</li>
        <li>Go to Settings → copy your Personal API Token</li>
        <li>Install the LinkedIn Agent Chrome extension</li>
        <li>Open a LinkedIn profile and click "Draft note"</li>
      </ol>
    </div>
    <p style="margin:24px 0 0;font-size:12px;color:#aaa;">
      Sent to ${invitee} · You can ignore this if you weren't expecting it.
    </p>
  </div>
</body>
</html>`;
}
