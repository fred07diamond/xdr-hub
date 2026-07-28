import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { eq, isNotNull } from "drizzle-orm";
import { getDb } from "../db/index.js";
import { icpPersonas, icpSources } from "../db/schema.js";
import { getOwnerCtx } from "./get-owner-ctx.js";

type Db = ReturnType<typeof getDb>;

export interface ProfileData {
  name?: string | null;
  headline?: string | null;
  role?: string | null;
  company?: string | null;
  about?: string | null;
  recentActivity?: string | null;
  profileUrl: string;
}

export interface PersonaMatch {
  icpText: string | null;
  personaId: string | null;
  personaName: string | null;
  personaColor: string | null;
}

function buildProfileBlurb(p: ProfileData): string {
  return [
    p.name,
    p.headline,
    p.role && p.company ? `${p.role} at ${p.company}` : p.company ?? p.role,
    p.about ? p.about.slice(0, 400) : null,
  ].filter(Boolean).join(" | ");
}

export function buildProfileSummary(p: ProfileData): string {
  return [
    p.name && `Name: ${p.name}`,
    p.headline && `Headline: ${p.headline}`,
    p.role && p.company
      ? `Role: ${p.role} at ${p.company}`
      : p.company
      ? `Company: ${p.company}`
      : null,
    p.about && `About (self-written bio — use this to assess real expertise and background):\n${p.about.slice(0, 1500)}`,
    p.recentActivity && `Recent activity: ${p.recentActivity.slice(0, 300)}`,
  ].filter(Boolean).join("\n");
}

export async function selectPersona(db: Db, profile: ProfileData): Promise<PersonaMatch> {
  const personasWithDocs = await db
    .select({ id: icpPersonas.id, name: icpPersonas.name, color: icpPersonas.color, icpText: icpPersonas.icpText, summary: icpPersonas.summary })
    .from(icpPersonas)
    .where(isNotNull(icpPersonas.icpText));

  if (personasWithDocs.length === 1) {
    const p = personasWithDocs[0];
    return { icpText: p.icpText ?? null, personaId: p.id, personaName: p.name, personaColor: p.color };
  }

  if (personasWithDocs.length > 1) {
    const ownerCtxForSel = await getOwnerCtx();
    const personaList = personasWithDocs
      .map((p, i) => `${i + 1}. ${p.name}: ${(p.summary ?? p.icpText ?? "").slice(0, 300)}`)
      .join("\n\n");
    const profileBlurb = buildProfileBlurb(profile);

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
      return { icpText: picked.icpText ?? null, personaId: picked.id, personaName: picked.name, personaColor: picked.color };
    } catch {
      const p = personasWithDocs[0];
      return { icpText: p.icpText ?? null, personaId: p.id, personaName: p.name, personaColor: p.color };
    }
  }

  // Fallback: legacy singleton ICP source (no per-persona setup yet)
  const icpRow = await db
    .select({ icpText: icpSources.icpText })
    .from(icpSources)
    .where(eq(icpSources.id, "singleton"))
    .limit(1);
  return { icpText: icpRow[0]?.icpText ?? null, personaId: null, personaName: null, personaColor: null };
}
