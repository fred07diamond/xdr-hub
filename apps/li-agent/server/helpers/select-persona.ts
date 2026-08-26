import { completeText, runWithRequestContext } from "@agent-native/core/server";
import { eq } from "drizzle-orm";
import { getPersonaCriteriaText, getSharedDb, sharedPersonas } from "@xdr-hub/shared/server";
import { getDb } from "../db/index.js";
import { icpSources } from "../db/schema.js";
import { getOwnerCtx } from "./get-owner-ctx.js";

type Db = ReturnType<typeof getDb>;
type SharedDb = ReturnType<typeof getSharedDb>;

interface PersonaWithCriteria {
  id: string;
  name: string;
  color: string;
  summary: string | null;
  icpText: string;
}

// Personas now live in the shared table (packages/shared) so create/update/
// delete-icp-persona no longer touch local icpPersonas at all -- reading
// icpPersonas.icpText here would silently freeze on stale data forever.
// Criteria text has no cached column on the shared table (see
// getPersonaCriteriaText's own doc comment), so it's computed fresh per
// persona. "Has docs" replaces the old `isNotNull(icpText)` filter.
async function loadPersonasWithCriteria(sharedDb: SharedDb): Promise<PersonaWithCriteria[]> {
  const allPersonas = await sharedDb
    .select({ id: sharedPersonas.id, name: sharedPersonas.name, color: sharedPersonas.color, summary: sharedPersonas.summary })
    .from(sharedPersonas)
    .orderBy(sharedPersonas.name);

  const withCriteria = await Promise.all(
    allPersonas.map(async (p) => {
      const { text, docCount } = await getPersonaCriteriaText(sharedDb, p.id);
      return docCount > 0 && text ? { ...p, icpText: text } : null;
    }),
  );

  return withCriteria.filter((p): p is PersonaWithCriteria => p !== null);
}

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
  const personasWithDocs = await loadPersonasWithCriteria(getSharedDb());

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
          systemPrompt: "You match LinkedIn profiles to ICP personas. Reply with ONLY the number of the best-matching persona (e.g. '2'). If none clearly fits, reply '0'.",
          input: `Personas:\n${personaList}\n\nProfile: ${profileBlurb}`,
          maxOutputTokens: 5,
        });
      const selResult = ownerCtxForSel
        ? await runWithRequestContext(ownerCtxForSel, selectCall)
        : await selectCall();
      // "0", unparseable text, or an out-of-range number all mean "no clear
      // match" -- this used to default to personasWithDocs[0] (whichever
      // persona happens to sort first, an arbitrary and unstable choice with
      // no ORDER BY on the query), which is how a "VP Design" profile could
      // get confidently labeled with a completely unrelated persona instead
      // of being left unscored. No persona (null) is a more honest outcome
      // than a specific, silently-wrong one.
      const idx = parseInt(selResult.text.trim(), 10) - 1;
      const picked = personasWithDocs[idx];
      if (!picked) return { icpText: null, personaId: null, personaName: null, personaColor: null };
      return { icpText: picked.icpText ?? null, personaId: picked.id, personaName: picked.name, personaColor: picked.color };
    } catch {
      // A failed LLM call is a real "we don't know," not "assume persona 1."
      return { icpText: null, personaId: null, personaName: null, personaColor: null };
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

export interface BatchProfileInput {
  name?: string | null;
  headline?: string | null;
  company?: string | null;
}

// Classifies a whole batch of profiles (e.g. an entire Sales Nav lead list
// import) in ONE LLM call instead of one call per profile -- N sequential
// completeText calls for a real-sized import (tens to hundreds of leads)
// would blow well past a serverless function's request timeout. Only makes
// an LLM call at all when there's a genuine choice between >1 persona;
// 0 or 1 personas resolve instantly with no LLM cost, same as selectPersona.
export async function selectPersonasBatch(db: Db, profiles: BatchProfileInput[]): Promise<PersonaMatch[]> {
  const personasWithDocs = await loadPersonasWithCriteria(getSharedDb());

  if (personasWithDocs.length === 0) {
    const icpRow = await db
      .select({ icpText: icpSources.icpText })
      .from(icpSources)
      .where(eq(icpSources.id, "singleton"))
      .limit(1);
    const icpText = icpRow[0]?.icpText ?? null;
    return profiles.map(() => ({ icpText, personaId: null, personaName: null, personaColor: null }));
  }

  if (personasWithDocs.length === 1) {
    const p = personasWithDocs[0];
    return profiles.map(() => ({ icpText: p.icpText ?? null, personaId: p.id, personaName: p.name, personaColor: p.color }));
  }

  // No confident match, an out-of-range pick, or a line the regex couldn't
  // parse (including one truncated off the end of the response) all mean
  // "we don't know" now -- this used to silently fall back to
  // personasWithDocs[0] (whichever persona happens to sort first; the query
  // has no ORDER BY, so that isn't even a stable choice), which is how an
  // unambiguous "VP Design" profile could end up confidently labeled with
  // some unrelated persona instead of being left unscored. Leaving personaId
  // null is a more honest outcome than a specific, silently-wrong one, and
  // the UI already renders no persona chip at all when it's null.
  const noPersonaForAll = () =>
    profiles.map(() => ({ icpText: null, personaId: null, personaName: null, personaColor: null }));

  const personaList = personasWithDocs
    .map((p, i) => `${i + 1}. ${p.name}: ${(p.summary ?? p.icpText ?? "").slice(0, 300)}`)
    .join("\n\n");
  const profileList = profiles
    .map((p, i) => `${i + 1}. ${[p.name, p.headline, p.company].filter(Boolean).join(" | ") || "(no info)"}`)
    .join("\n");

  try {
    const ownerCtxForSel = await getOwnerCtx();
    const call = () =>
      completeText({
        systemPrompt:
          "You match a numbered list of LinkedIn profiles to a numbered list of ICP personas. " +
          'Reply with ONLY one line per profile, in the exact format "<profile number>:<persona number>", nothing else. ' +
          "If a profile doesn't clearly fit any persona, use persona 0 for that line.",
        input: `Personas:\n${personaList}\n\nProfiles:\n${profileList}`,
        // ~6 tokens/profile was cutting responses off mid-batch for larger
        // imports -- everything after the truncation point silently fell
        // back to "persona 1" below with no signal anything had gone wrong.
        // More headroom per line ("<n>:<m>\n" plus normal model formatting
        // slop) makes that failure mode much less likely to trigger at all.
        maxOutputTokens: Math.max(300, profiles.length * 16),
      });
    const result = ownerCtxForSel ? await runWithRequestContext(ownerCtxForSel, call) : await call();

    const picks = new Map<number, number>();
    for (const line of result.text.split("\n")) {
      const m = line.match(/(\d+)\s*[:\-]\s*(\d+)/);
      if (m) picks.set(parseInt(m[1], 10), parseInt(m[2], 10));
    }

    return profiles.map((_, i) => {
      const pick = picks.get(i + 1);
      if (pick === undefined || pick === 0) {
        return { icpText: null, personaId: null, personaName: null, personaColor: null };
      }
      const picked = personasWithDocs[pick - 1];
      if (!picked) return { icpText: null, personaId: null, personaName: null, personaColor: null };
      return { icpText: picked.icpText ?? null, personaId: picked.id, personaName: picked.name, personaColor: picked.color };
    });
  } catch {
    return noPersonaForAll();
  }
}
