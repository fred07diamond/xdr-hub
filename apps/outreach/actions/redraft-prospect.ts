import { defineAction } from "@agent-native/core";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas, icpSources, prospects } from "../server/db/schema.js";

// Resolved once on first use — same pattern as capture-profile.
let _ownerCtx: { userEmail: string; orgId?: string } | null | undefined = undefined;

async function getOwnerCtx() {
  if (_ownerCtx !== undefined) return _ownerCtx;
  const email = process.env.WORKSPACE_OWNER_EMAIL;
  if (!email) { _ownerCtx = null; return null; }
  try {
    const orgId = await resolveOrgIdForEmail(email);
    _ownerCtx = { userEmail: email, orgId: orgId ?? undefined };
  } catch {
    _ownerCtx = { userEmail: email };
  }
  return _ownerCtx;
}

export default defineAction({
  description: "Re-run AI scoring and note drafting for an existing prospect without recapturing the profile.",
  schema: z.object({
    id: z.string().min(1),
  }),
  requiresAuth: true,
  run: async ({ id }, ctx) => {
    const db = getDb();
    const userEmail = ctx?.userEmail;
    if (!userEmail) throw new Error("Authentication required");

    // Load the existing prospect, enforcing ownership.
    const rows = await db
      .select()
      .from(prospects)
      .where(and(eq(prospects.id, id), eq(prospects.ownerEmail, userEmail)))
      .limit(1);

    if (!rows[0]) throw new Error("Prospect not found");
    const prospect = rows[0];

    // Persona selection — same logic as capture-profile.
    const allPersonas = await db
      .select({
        id: icpPersonas.id,
        name: icpPersonas.name,
        color: icpPersonas.color,
        icpText: icpPersonas.icpText,
        summary: icpPersonas.summary,
      })
      .from(icpPersonas);

    const personasWithDocs = allPersonas.filter((p) => p.icpText);

    let icpText: string | null = null;
    let personaId: string | null = null;
    let personaName: string | null = null;
    let personaColor: string | null = null;

    if (personasWithDocs.length === 1) {
      const p = personasWithDocs[0];
      icpText = p.icpText ?? null;
      personaId = p.id;
      personaName = p.name;
      personaColor = p.color;
    } else if (personasWithDocs.length > 1) {
      const ownerCtxForSel = await getOwnerCtx();
      const personaList = personasWithDocs
        .map((p, i) => `${i + 1}. ${p.name}: ${(p.summary ?? p.icpText ?? "").slice(0, 300)}`)
        .join("\n\n");
      const profileBlurb = [
        prospect.name,
        prospect.headline,
        prospect.role && prospect.company ? `${prospect.role} at ${prospect.company}` : prospect.company ?? prospect.role,
        prospect.about ? prospect.about.slice(0, 400) : null,
      ].filter(Boolean).join(" | ");

      try {
        const selectCall = () =>
          completeText({
            systemPrompt: "You match LinkedIn profiles to ICP personas. Reply with ONLY the number of the best-matching persona (e.g. '2'). If none fits, reply '1'.",
            input: `Personas:\n${personaList}\n\nProfile: ${profileBlurb}`,
            maxOutputTokens: 5,
          });
        const selResult = ownerCtxForSel
          ? await runWithRequestContext(ownerCtxForSel, selectCall)
          : await selectCall();
        const idx = parseInt(selResult.text.trim()) - 1;
        const picked = personasWithDocs[idx] ?? personasWithDocs[0];
        icpText = picked.icpText ?? null;
        personaId = picked.id;
        personaName = picked.name;
        personaColor = picked.color;
      } catch {
        const p = personasWithDocs[0];
        icpText = p.icpText ?? null;
        personaId = p.id;
        personaName = p.name;
        personaColor = p.color;
      }
    } else {
      const icpRow = await db
        .select({ icpText: icpSources.icpText })
        .from(icpSources)
        .where(eq(icpSources.id, "singleton"))
        .limit(1);
      icpText = icpRow[0]?.icpText ?? null;
    }

    const profileSummary = [
      prospect.name && `Name: ${prospect.name}`,
      prospect.headline && `Headline: ${prospect.headline}`,
      prospect.role && prospect.company
        ? `Role: ${prospect.role} at ${prospect.company}`
        : prospect.company
        ? `Company: ${prospect.company}`
        : null,
      prospect.about && `About (self-written bio — use this to assess real expertise and background):\n${prospect.about.slice(0, 1500)}`,
      prospect.recentActivity && `Recent activity: ${prospect.recentActivity.slice(0, 300)}`,
    ].filter(Boolean).join("\n");

    let fitVerdict: "strong" | "possible" | "weak" = "possible";
    let fitReason = icpText ? "Draft pending." : "No ICP document uploaded — scored from profile alone.";
    let draftNote = "";
    let draftFollowUp: string | null = null;

    try {
      const ownerCtx = await getOwnerCtx();
      const icpBlock = icpText
        ? `ICP document:\n${icpText.slice(0, 3000)}\n\n`
        : "No ICP document uploaded — score from the profile alone and flag this in fitReason.\n\n";

      const callCompleteText = () =>
        completeText({
          systemPrompt:
            "You are a LinkedIn outreach assistant. Score fit and draft a personalized connection note.\n\n" +
            icpBlock +
            "Scoring rubric — be decisive, don't hedge:\n" +
            "- strong: title + seniority match the ICP, OR clear behavioral signals (sharing/praising AI dev tools, design systems, or vendors in the space — even a single specific post counts). If the evidence points to strong, score it strong.\n" +
            "- possible: genuine uncertainty only — title is adjacent OR seniority is one level off, AND no behavioral signals exist.\n" +
            "- weak: clear mismatch — wrong function, clearly too junior, or explicit counter-evidence.\n\n" +
            "Behavioral signals in recent activity outweigh a generic About. A post engaging with a specific tool, person, or theme in the space is stronger evidence than years of experience. Score up when signals exist.\n\n" +
            'Reply with valid JSON only: { "fitVerdict": "strong"|"possible"|"weak", "fitReason": "<one sentence citing the strongest specific evidence — lead with behavioral signals if present>", ' +
            '"draftNote": "<connection note, max 200 chars, genuine and specific — if recent activity is available, reference it>", ' +
            '"draftFollowUp": "<follow-up to send after they accept, max 100 chars>" }',
          input: profileSummary || `LinkedIn profile: ${prospect.profileUrl}`,
          maxOutputTokens: 700,
        });
      const result = ownerCtx
        ? await runWithRequestContext(ownerCtx, callCompleteText)
        : await callCompleteText();

      const raw = result.text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/i, "").trim();

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(raw);
      } catch {
        const g = (re: RegExp) => re.exec(raw)?.[1]?.trim() ?? null;
        parsed = {
          fitVerdict: g(/"fitVerdict"\s*:\s*"(strong|possible|weak)"/i),
          fitReason:  g(/"fitReason"\s*:\s*"([^"\\]*)"/),
          draftNote:  g(/"draftNote"\s*:\s*"([^"\\]*)"/),
          draftFollowUp: g(/"draftFollowUp"\s*:\s*"([^"\\]*)"/),
        };
        if (!parsed.fitVerdict && !parsed.draftNote) throw new Error("Unparseable model response");
      }

      const v = String(parsed.fitVerdict ?? "");
      if (v === "strong" || v === "possible" || v === "weak") fitVerdict = v;
      if (parsed.fitReason) fitReason = String(parsed.fitReason);
      if (parsed.draftNote) draftNote = String(parsed.draftNote).slice(0, 300);
      if (parsed.draftFollowUp) draftFollowUp = String(parsed.draftFollowUp).slice(0, 150);
    } catch (err) {
      fitReason = `Draft failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    await db
      .update(prospects)
      .set({
        fitVerdict,
        fitReason,
        draftNote,
        draftFollowUp,
        personaId,
        personaName,
        personaColor,
        status: "drafted",
        updatedAt: new Date().toISOString(),
      })
      .where(eq(prospects.id, id));

    return {
      ok: true,
      draft: { fitVerdict, fitReason, draftNote, draftFollowUp, personaName, personaColor },
    };
  },
});
