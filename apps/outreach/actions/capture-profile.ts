import { defineAction } from "@agent-native/core";
import { resolveOrgIdForEmail } from "@agent-native/core/org";
import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { nanoid } from "nanoid";
import { z } from "zod";
import { getDb } from "../server/db/index.js";
import { icpPersonas, icpSources, messagingEdges, messagingNodes, prospects } from "../server/db/schema.js";
import { resolveOwner } from "../server/helpers/resolve-owner.js";

type DbType = ReturnType<typeof getDb>;
type DbNode = typeof messagingNodes.$inferSelect;

// BFS down from the matched persona's canvas node, collecting all fine-tuning nodes.
// Returns a text block persona→leaves, or null if nothing is configured.
// edges are scoped to ownerEmail so each user's chain is independent.
async function buildMessagingContext(personaId: string | null, ownerEmail: string | null, db: DbType): Promise<string | null> {
  if (!personaId) return null;

  const edgeFilter = ownerEmail ? eq(messagingEdges.ownerEmail, ownerEmail) : isNull(messagingEdges.ownerEmail);
  const [nodes, edges] = await Promise.all([
    db.select().from(messagingNodes),
    db.select().from(messagingEdges).where(edgeFilter),
  ]);

  if (nodes.length === 0) return null;

  // Find the persona canvas node (root of this persona's messaging tree)
  const personaNode = nodes.find((n) => n.type === "persona" && n.personaId === personaId) ?? null;
  if (!personaNode) return null;

  // BFS down: follow edges where sourceId === current.id
  const chain: DbNode[] = [];
  const queue: DbNode[] = [personaNode];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current.id)) continue;
    visited.add(current.id);
    chain.push(current);
    for (const edge of edges.filter((e) => e.sourceId === current.id)) {
      const child = nodes.find((n) => n.id === edge.targetId);
      if (child && !visited.has(child.id)) queue.push(child);
    }
  }

  const hasContent = (n: DbNode) =>
    n.tone || n.valueProps || n.phrasesToUse || n.phrasesToAvoid || n.exampleNotes || n.notes;

  if (!chain.some(hasContent)) return null;

  const lines: string[] = ["MESSAGING GUIDELINES — apply when drafting the connection note:"];
  for (const n of chain) {
    if (!hasContent(n)) continue;
    const t = n.type;
    if (t === "persona" || t === "global") {
      lines.push(`\n[${t === "persona" ? `Persona: ${n.title}` : "Global Baseline"}]`);
      if (n.tone) lines.push(`Tone/Voice: ${n.tone}`);
      if (n.valueProps) lines.push(`Key value props: ${n.valueProps}`);
      if (n.phrasesToUse) lines.push(`Always use: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`Never say: ${n.phrasesToAvoid}`);
      if (n.exampleNotes) lines.push(`Examples:\n${n.exampleNotes}`);
      if (n.notes) lines.push(n.notes);
    } else if (t === "tone") {
      lines.push(`\n[Tone & Voice${n.title !== "Tone & Voice" ? ` — ${n.title}` : ""}]`);
      if (n.tone) lines.push(n.tone);
      if (n.valueProps) lines.push(`Key value props: ${n.valueProps}`);
    } else if (t === "phrase_rule") {
      lines.push(`\n[Phrase Rule${n.title !== "Phrase Rule" ? ` — ${n.title}` : ""}]`);
      if (n.phrasesToUse) lines.push(`✓ Always use: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`✗ Never say: ${n.phrasesToAvoid}`);
    } else if (t === "example") {
      lines.push(`\n[Example Note${n.title !== "Example Note" ? ` — ${n.title}` : ""}]`);
      if (n.exampleNotes) lines.push(`Write notes like this:\n${n.exampleNotes}`);
    } else if (t === "role") {
      lines.push(`\n[Role: ${n.title}]`);
      if (n.notes) lines.push(`When messaging someone in this role:\n${n.notes}`);
      if (n.tone) lines.push(`Tone adjustment: ${n.tone}`);
      if (n.phrasesToUse) lines.push(`✓ Prefer: ${n.phrasesToUse}`);
      if (n.phrasesToAvoid) lines.push(`✗ Avoid: ${n.phrasesToAvoid}`);
    }
  }

  return lines.join("\n").trim();
}

// Resolved once on first use — avoids a per-request DB round-trip for LLM attribution.
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
  description:
    "Ingest a LinkedIn profile captured by the Builder.LI extension. Upserts the prospect row, scores fit, and drafts a connection note synchronously.",
  schema: z.object({
    profileUrl: z.string().url().describe("LinkedIn profile URL"),
    name: z.string().nullish(),
    headline: z.string().nullish(),
    role: z.string().nullish(),
    company: z.string().nullish(),
    about: z.string().nullish(),
    recentActivity: z.string().nullish(),
    apiToken: z.string().nullish().describe("Personal API token from the user's Settings page"),
  }),
  requiresAuth: false,
  publicAgent: { expose: true, readOnly: false, requiresAuth: false },
  run: async (args, ctx) => {
    const db = getDb();
    const now = new Date().toISOString();

    const ownerEmail = await resolveOwner(args.apiToken, ctx);

    // Explicit upsert scoped to this owner (compound unique: profile_url + owner_email)
    const ownerFilter = ownerEmail
      ? eq(prospects.ownerEmail, ownerEmail)
      : isNull(prospects.ownerEmail);

    const existing = await db
      .select({ id: prospects.id })
      .from(prospects)
      .where(and(eq(prospects.profileUrl, args.profileUrl), ownerFilter))
      .limit(1);

    const id = existing[0]?.id ?? nanoid();

    if (existing[0]) {
      await db
        .update(prospects)
        .set({
          name: args.name ?? null,
          headline: args.headline ?? null,
          role: args.role ?? null,
          company: args.company ?? null,
          about: args.about ?? null,
          recentActivity: args.recentActivity ?? null,
          status: "captured",
          updatedAt: now,
        })
        .where(eq(prospects.id, id));
    } else {
      await db.insert(prospects).values({
        id,
        ownerEmail,
        profileUrl: args.profileUrl,
        name: args.name ?? null,
        headline: args.headline ?? null,
        role: args.role ?? null,
        company: args.company ?? null,
        about: args.about ?? null,
        recentActivity: args.recentActivity ?? null,
        status: "captured",
        createdAt: now,
        updatedAt: now,
      });
    }

    // Persona selection — only load personas that have ICP docs (filter in DB, not JS)
    const personasWithDocs = await db
      .select({
        id: icpPersonas.id,
        name: icpPersonas.name,
        color: icpPersonas.color,
        icpText: icpPersonas.icpText,
        summary: icpPersonas.summary,
      })
      .from(icpPersonas)
      .where(isNotNull(icpPersonas.icpText));

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
        args.name,
        args.headline,
        args.role && args.company ? `${args.role} at ${args.company}` : args.company ?? args.role,
        args.about ? args.about.slice(0, 400) : null,
      ].filter(Boolean).join(" | ");

      try {
        const selectCall = () =>
          completeText({
            systemPrompt:
              "You match LinkedIn profiles to ICP personas. Reply with ONLY the number of the best-matching persona (e.g. '2'). If none fits, reply '1'.",
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
      args.name && `Name: ${args.name}`,
      args.headline && `Headline: ${args.headline}`,
      args.role && args.company
        ? `Role: ${args.role} at ${args.company}`
        : args.company
        ? `Company: ${args.company}`
        : null,
      args.about && `About (self-written bio — use this to assess real expertise and background):\n${args.about.slice(0, 1500)}`,
      args.recentActivity && `Recent activity: ${args.recentActivity.slice(0, 300)}`,
    ]
      .filter(Boolean)
      .join("\n");

    let fitVerdict: "strong" | "possible" | "weak" | "inconclusive" = "inconclusive";
    let fitReason = "No ICP document uploaded — add ICP criteria on the ICP tab to enable fit scoring.";
    let draftNote = "";
    let draftFollowUp: string | null = null;

    try {
      const ownerCtx = await getOwnerCtx();

      const messagingContext = await buildMessagingContext(personaId, ownerEmail, db);
      const messagingBlock = messagingContext ? `\n${messagingContext}\n\n` : "";

      const systemPrompt = icpText
        ? "You are a LinkedIn outreach assistant. Score fit and draft a personalized connection note.\n\n" +
          `ICP document:\n${icpText.slice(0, 3000)}\n\n` +
          messagingBlock +
          "Scoring rubric — be decisive, don't hedge:\n" +
          "- strong: title + seniority match the ICP, OR clear behavioral signals. If evidence points to strong, score it strong.\n" +
          "- possible: genuine uncertainty only — title is adjacent OR seniority is one level off, AND no behavioral signals.\n" +
          "- weak: clear mismatch — wrong function, clearly too junior, or explicit counter-evidence.\n\n" +
          "Behavioral signals in recent activity outweigh a generic About.\n\n" +
          'Reply with valid JSON only: { "fitVerdict": "strong"|"possible"|"weak", "fitReason": "<one sentence citing the strongest specific evidence>", ' +
          '"draftNote": "<connection note, max 200 chars, genuine and specific>", ' +
          '"draftFollowUp": "<follow-up to send after they accept, max 100 chars>" }'
        : "You are a LinkedIn outreach assistant. No ICP document has been uploaded, so you cannot score fit.\n\n" +
          messagingBlock +
          'Reply with valid JSON only: { "fitVerdict": "inconclusive", "fitReason": "No ICP document uploaded — add ICP criteria on the ICP tab to enable fit scoring.", ' +
          '"draftNote": "<a brief, generic, professional connection note based only on the profile, max 200 chars — do not reference any ICP or scoring criteria>", ' +
          '"draftFollowUp": "<a short generic follow-up, max 100 chars>" }';

      const callCompleteText = () =>
        completeText({
          systemPrompt,
          input: profileSummary || `LinkedIn profile: ${args.profileUrl}`,
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
          fitVerdict: g(/"fitVerdict"\s*:\s*"(strong|possible|weak|inconclusive)"/i),
          fitReason:  g(/"fitReason"\s*:\s*"([^"\\]*)"/),
          draftNote:  g(/"draftNote"\s*:\s*"([^"\\]*)"/),
          draftFollowUp: g(/"draftFollowUp"\s*:\s*"([^"\\]*)"/),
        };
        if (!parsed.fitVerdict && !parsed.draftNote) throw new Error("Unparseable model response");
      }

      const v = String(parsed.fitVerdict ?? "");
      if (v === "strong" || v === "possible" || v === "weak" || v === "inconclusive") {
        fitVerdict = v;
      }
      if (parsed.fitReason) fitReason = String(parsed.fitReason);
      if (parsed.draftNote) draftNote = String(parsed.draftNote).slice(0, 300);
      if (parsed.draftFollowUp) draftFollowUp = String(parsed.draftFollowUp).slice(0, 150);
    } catch (err) {
      fitReason = `Draft failed: ${err instanceof Error ? err.message : String(err)}`;
    }

    const draftedAt = new Date().toISOString();
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
        updatedAt: draftedAt,
      })
      .where(eq(prospects.id, id));

    return { id, status: "drafted" as const, fitVerdict, fitReason, draftNote, draftFollowUp, personaName, personaColor };
  },
});
