import type { IntroCallDeal, IntroCallOtherContact, IntroCallResearch } from "./intro-call-hubspot.js";
import type { IntroCallScorecard } from "./intro-call-score.js";
import { INTRO_CALL_REFERENCE } from "./intro-call-reference.js";
import { completeJsonWithRetry } from "./complete-text-retry.js";

export type PillarLabel = "Confirmed" | "Hypothesis" | "Unknown";

// Only the judgment calls come from the model -- product ID, Enterprise
// Need, and ICP Fit are already deterministic (intro-call-score.ts) and get
// rendered directly from structured data, not from LLM prose, so the UI can
// show a scannable scorecard instead of paragraphs the xDR has to read.
export interface IntroCallCheckpoint {
  tldr: string;
  painScore: number;
  painLabel: PillarLabel;
  painRationale: string;
  championScore: number;
  championLabel: PillarLabel;
  championRationale: string;
  recommendation: "take_call" | "pivot_ae" | "disqualify";
  recommendationRationale: string;
}

export interface EmailOutput {
  subject: string;
  body: string;
}

function fmtDeal(d: IntroCallDeal): string {
  const closedLost = d.closedLostReasonCategory ? ` -- Closed Lost: ${d.closedLostReasonCategory}${d.closedLostReasonDetail ? ` (${d.closedLostReasonDetail})` : ""}` : "";
  return `${d.name ?? "(unnamed)"} - stage ${d.stage ?? "?"}${d.ownerName ? ` - owner ${d.ownerName}` : ""}${closedLost}`;
}

function fmtContact(c: IntroCallOtherContact): string {
  return `${c.name ?? "(unnamed)"}${c.jobTitle ? ` (${c.jobTitle})` : ""}${c.activeInBuilderApp ? " -- active in Builder app" : ""}`;
}

function buildResearchBlock(research: IntroCallResearch, scorecard: IntroCallScorecard): string {
  const c = research.contact;
  const co = research.company;
  return `HubSpot research for this lead:

Contact: ${c.name ?? "unknown"}, title: ${c.jobTitle ?? "unknown"}, location: ${c.location ?? "unknown"}
LinkedIn: ${c.linkedinUrl ?? "none on file"}
Source: ${c.source ?? "unknown"}, last activity: ${c.lastActivityDate ?? "unknown"}
First conversion: ${c.firstConversion ?? "unknown"}, recent conversion: ${c.recentConversion ?? "unknown"}
Message (verbatim): ${c.messageVerbatim ?? "(no message captured)"}
Company Fit Score (Breeze): ${c.breezeFitScore ?? "unknown"}
Sign Up Time Stamp: ${c.signUpTimeStamp ?? "unknown"}
First Space Kind (contact record): ${c.firstSpaceKind ?? "unset"}
Job Functions from Product Sign Up: ${c.jobFunctions ?? "--"}
How You Heard About Builder: ${c.howHeardAboutBuilder ?? "--"}
Notes: ${c.numNotes} (${research.notesUnreadable ? "non-zero, bodies not readable -- ask the xDR to paste if relevant" : "none"})

Company: ${co?.name ?? "unknown"}, domain: ${co?.domain ?? "unknown"}, industry: ${co?.industry ?? "unknown"}, employees: ${co?.employeeCount ?? "unknown"}, location: ${co?.location ?? "unknown"}${co?.parentCompanyName ? `, parent company: ${co.parentCompanyName}` : ""}

Other contacts on the account (${research.otherContacts.length}, ${research.activeInAppUserCount} active in Builder app):
${research.otherContacts.length ? research.otherContacts.map(fmtContact).join("\n") : "None"}

Deals on the account:
${research.deals.length ? research.deals.map(fmtDeal).join("\n") : "None -- clean account"}

Deterministic scorecard (already computed -- use these, do not recompute):
Product: ${scorecard.product} (signal: ${scorecard.productSignal})${scorecard.productNeedsConfirmation ? " -- NEEDS CONFIRMATION from the xDR, ask before finalizing" : ""}
Enterprise Need: ${scorecard.enterpriseNeed.score}/10 -- ${scorecard.enterpriseNeed.label} (${scorecard.enterpriseNeed.signals.join("; ") || "no signals"})
ICP Fit: ${scorecard.icpFit.score}/10 -- ${scorecard.icpFit.label} (${scorecard.icpFit.signals.join("; ") || "no signals"})
Maturity stage (Code only): ${scorecard.maturityStage ?? "not placed"}${scorecard.maturityStageReason ? ` -- ${scorecard.maturityStageReason}` : ""}
Seat math: ${scorecard.seatMath ? `${scorecard.seatMath.activeUsers} active users, over 20-seat cap: ${scorecard.seatMath.overTwentySeatCap}` : "n/a (Content)"}
Enterprise feature matches: ${scorecard.enterpriseFeatureMatches.join(", ") || "none"}
Closed Lost override: ${scorecard.closedLostOverride.applies ? `APPLIES -- ${scorecard.closedLostOverride.reason} (deal: ${scorecard.closedLostOverride.dealName})` : "does not apply"}
Agency signal: ${scorecard.agencySignal.looksLikeAgency ? `YES -- ${scorecard.agencySignal.evidence}` : "no"}
Hard disqualify gate: ${scorecard.hardDisqualify.applies ? `APPLIES -- ${scorecard.hardDisqualify.reasons.join("; ")}` : "does not apply"}
Suggested recommendation: ${scorecard.recommendation} (${scorecard.recommendationReasons.join("; ")})`;
}

const CHECKPOINT_CONTRACT = `## Your task

This is a quick-answer tool -- the xDR needs a fast, scannable read, not a document. Every fact (contact, company, deals, the deterministic Enterprise Need and ICP Fit numbers) is already rendered directly by the app from structured data, so your job is ONLY the judgment calls: the TLDR, your own Pain and Potential Champion scores, and the final recommendation. Do not restate facts you're given -- reason about them.

- tldr: 2-3 sentences in plain language -- who they are, real company, what they seem to want, whether it looks like an agency/reseller motion, and the gist of whether it's worth taking. No scores, no jargon. This is the one thing the xDR reads without expanding anything, so make it count.
- painScore / painLabel: your own score (0-10) and label (Confirmed/Hypothesis/Unknown) for Pain we can solve, per the reference doc's Scoring Logic.
- painRationale: ONE short sentence (under 20 words) explaining the pain score. No preamble, just the reason, e.g. "Message only says 'test the feature,' no described cost or team impact yet."
- championScore / championLabel: your own score and label for Potential Champion, per the champion-vs-coach acid test in the reference doc.
- championRationale: ONE short sentence (under 20 words), same style as painRationale.
- recommendation: "take_call", "pivot_ae", or "disqualify". If the input's "Hard disqualify gate" says APPLIES, recommendation MUST be "disqualify" -- this is a firm business rule (region, industry, company size, or academic), not a judgment call, and it overrides everything else including a strong Pain or Champion read. Otherwise, default to the deterministic suggested recommendation given in the input unless your own Pain/Champion read gives real cause to diverge.
- recommendationRationale: 1-2 plain sentences giving the reasons only, written the way you'd say it out loud. Do NOT write "My read" or restate the recommendation itself -- the UI already shows that as the headline right above this text. Just the reasoning, e.g. "The message itself is too vague to size the pain, and Chuong isn't clearly a champion, but seven active users including a Technical Lead is worth 15 minutes to understand what's happening inside the account." If the hard disqualify gate applied, state which reason(s) plainly instead, e.g. "Under our 100-employee floor with a one-word message, so this doesn't clear the bar for a call."

Reply with valid JSON only, no markdown fences, no explanation:
{
  "tldr": "...",
  "painScore": 0,
  "painLabel": "Confirmed" | "Hypothesis" | "Unknown",
  "painRationale": "...",
  "championScore": 0,
  "championLabel": "Confirmed" | "Hypothesis" | "Unknown",
  "championRationale": "...",
  "recommendation": "take_call" | "pivot_ae" | "disqualify",
  "recommendationRationale": "..."
}`;

export async function generateCheckpointOne(research: IntroCallResearch, scorecard: IntroCallScorecard): Promise<IntroCallCheckpoint> {
  const parsed = await completeJsonWithRetry<IntroCallCheckpoint>({
    systemPrompt: `${INTRO_CALL_REFERENCE}\n\n${CHECKPOINT_CONTRACT}`,
    input: buildResearchBlock(research, scorecard),
    maxOutputTokens: 2000,
  });
  return {
    tldr: String(parsed.tldr ?? ""),
    painScore: Number(parsed.painScore ?? 0) || 0,
    painLabel: (["Confirmed", "Hypothesis", "Unknown"] as const).includes(parsed.painLabel as PillarLabel)
      ? (parsed.painLabel as PillarLabel)
      : "Unknown",
    painRationale: String(parsed.painRationale ?? ""),
    championScore: Number(parsed.championScore ?? 0) || 0,
    championLabel: (["Confirmed", "Hypothesis", "Unknown"] as const).includes(parsed.championLabel as PillarLabel)
      ? (parsed.championLabel as PillarLabel)
      : "Unknown",
    championRationale: String(parsed.championRationale ?? ""),
    recommendation: (["take_call", "pivot_ae", "disqualify"] as const).includes(
      parsed.recommendation as IntroCallCheckpoint["recommendation"],
    )
      ? parsed.recommendation
      : "take_call",
    recommendationRationale: String(parsed.recommendationRationale ?? ""),
  };
}

const TAKE_CALL_EMAIL_CONTRACT = `## Your task

Write the pre-call email (Branch A -- take the call). Booked time stays. Confirm the call, frame as a working session, preview 1-2 things to cover tied to their stated need, optionally ask if anyone else should join only if there's a real reason (e.g. another active contact on the account). No AE referenced. Under 75 words. Follow this exact shape:

Subject: Quick note ahead of our call

Hi [First Name],

Thanks for confirming time to [acknowledge their specific request, plainly].

To make the most of it, I'd love to understand [1-2 things tied to their stated need]. That'll help me point you in the right direction.

[Optional, only with a real reason: I noticed [Name] has also been active recently. Worth including them, or keep this between us first?]

Anything specific you want to make sure we cover?

Thanks,
[xDR Name]

Reply with valid JSON only, no markdown fences: {"subject": "...", "body": "..."} -- body is everything after the Subject line (starting at "Hi [First Name],"), with [xDR Name] left as a literal placeholder for the xDR to fill in.`;

export async function generateTakeCallEmail(research: IntroCallResearch, scorecard: IntroCallScorecard, checkpoint: IntroCallCheckpoint): Promise<EmailOutput> {
  const parsed = await completeJsonWithRetry<EmailOutput>({
    systemPrompt: `${INTRO_CALL_REFERENCE}\n\n${TAKE_CALL_EMAIL_CONTRACT}`,
    input: `${buildResearchBlock(research, scorecard)}\n\nAgreed recommendation: take the call.\nRecommendation rationale: ${checkpoint.recommendationRationale}`,
    maxOutputTokens: 1500,
  });
  return { subject: String(parsed.subject ?? ""), body: String(parsed.body ?? "") };
}

function aeIntroEmailContract(timeWorks: boolean): string {
  const timeBlock = timeWorks
    ? "Keep the booked time, just extend it to 30 minutes. Ask if stretching to 30 minutes works."
    : "The booked time doesn't work for the AE. Note the swap and propose two specific alternatives, each marked 30 min, using the two times given in the input.";
  return `## Your task

Write the AE intro email (Branch B if the booked time works, Branch C if it doesn't). First ask nothing -- the AE and time-works answer are already given in the input. ${timeBlock} Introduce the AE, frame as intro plus working session. The context line for the AE stays factual, no jargon, since the prospect reads it too. No 75-word ceiling here. Follow this exact shape (drop the alternate-times bullets if the time works):

Subject: Update on our call, looping in [AE First Name]
(or, if the time doesn't work: Quick adjustment on our call, looping in [AE First Name])

Hi [First Name],

Thanks for confirming time to [acknowledge their request].

Based on what you shared, I'd like to bring [AE Full Name] into the conversation. [AE First Name] works with [relevant, plain connection]. Would stretching our time to 30 minutes work for you?
(or, if the time doesn't work: ...into the conversation. [AE First Name] works with [relevant connection]. The time you booked unfortunately doesn't work on their end. Could either of these work instead?

- [Time option 1] (30 min)
- [Time option 2] (30 min))

[AE First Name], quick context. [Prospect] is [title] at [Company]. They're [1-2 factual sentences].

Here's what we're thinking for the time:
- Intros and a quick look at [Company]
- [Agenda item tied to their need]
- How Builder fits and Q&A
- Next steps

[First Name], does this look right? (or, if the time doesn't work: [First Name], let me know which works.)

Thanks,
[xDR Name]

Reply with valid JSON only, no markdown fences: {"subject": "...", "body": "..."} -- body is everything after the Subject line, with [xDR Name] left as a literal placeholder.`;
}

export async function generateAeIntroEmail(
  research: IntroCallResearch,
  scorecard: IntroCallScorecard,
  checkpoint: IntroCallCheckpoint,
  ae: { name: string; email: string | null },
  timeWorks: boolean,
  altTimes: [string, string] | null,
): Promise<EmailOutput> {
  const parsed = await completeJsonWithRetry<EmailOutput>({
    systemPrompt: `${INTRO_CALL_REFERENCE}\n\n${aeIntroEmailContract(timeWorks)}`,
    input: `${buildResearchBlock(research, scorecard)}\n\nAgreed recommendation: pivot to AE.\nRecommendation rationale: ${checkpoint.recommendationRationale}\nAE: ${ae.name}${ae.email ? ` (${ae.email})` : ""}\nDoes the booked time work for the AE: ${timeWorks ? "yes" : "no"}${!timeWorks && altTimes ? `\nAlternate time option 1: ${altTimes[0]}\nAlternate time option 2: ${altTimes[1]}` : ""}`,
    maxOutputTokens: 1500,
  });
  return { subject: String(parsed.subject ?? ""), body: String(parsed.body ?? "") };
}

const QUALIFY_OUT_EMAIL_CONTRACT = `## Your task

Write the qualify-out email (disqualify branch). A polite redirect that leaves the door open for the prospect to qualify themselves back in. Frame the pass gracefully on use-case-fit grounds, never "you're too small." The shape: thank them, note that based on what they described and the research it looks like Builder isn't the fit (or another tool fits better), point them somewhere useful, and leave a clear opening. Follow this exact shape:

Subject: Quick note before our call

Hi [First Name],

Thanks for booking time and for giving Builder a try. Looking at what you described, [plain read of why it may not be the fit]. We help teams [what Builder does], so for [their actual need] you'd probably get further with [honest alternative].

If I've read that wrong, or you do want help with [what Builder does], I'm happy to keep our call. Otherwise no need, and best of luck with [their thing].

[xDR Name]

Reply with valid JSON only, no markdown fences: {"subject": "...", "body": "..."} -- body is everything after the Subject line, with [xDR Name] left as a literal placeholder.`;

export async function generateQualifyOutEmail(research: IntroCallResearch, scorecard: IntroCallScorecard, checkpoint: IntroCallCheckpoint): Promise<EmailOutput> {
  const parsed = await completeJsonWithRetry<EmailOutput>({
    systemPrompt: `${INTRO_CALL_REFERENCE}\n\n${QUALIFY_OUT_EMAIL_CONTRACT}`,
    input: `${buildResearchBlock(research, scorecard)}\n\nAgreed recommendation: disqualify.\nRecommendation rationale: ${checkpoint.recommendationRationale}`,
    maxOutputTokens: 1200,
  });
  return { subject: String(parsed.subject ?? ""), body: String(parsed.body ?? "") };
}

const WORKSHEET_CONTRACT = `## Your task

Produce the live-call worksheet markdown for a 15-minute qualification call. Keep it lean -- a tool for the call, not a briefing document. Use 3 to 4 questions covering all four pillars (weight Enterprise Need and Pain we can solve, plus the real-project/real-company check). For Builder Content, compress the five discovery questions (page volume, team size, current setup, page types, timeline) into 3-4 that fit the time. For Builder Code, also pin the maturity stage and advancement gates, and if seat expansion is plausible, one question must nail the exact seat count. Every Pain question must chase a number (a quantified from/to). At least one question must probe access to the economic buyer and (Builder Code) the path to engineering -- the champion acid test, not just a title read.

Each question needs a "### Question N -- [Topic] . Qualifying: [Pillar]" heading, the question as a "> " blockquote written conversationally, a "**Listen for:**" block with "- Good: ..." and "- Bad: ..." lines, and a "**Notes:**" field with an underscore blank.

Follow this exact structure:

# Live Call Worksheet -- [Prospect], [Company]

## Pre-Call Context

**Product:** [Builder Content / Builder Code + the signal]
**Likely use case:** [or "unclear, confirm live"]
**Track:** [Builder Code: maturity stage + next-stage target + engineering path read. Builder Content: not on the model, Visual CMS to Optimization to Localization.]
**Form message:** "[verbatim]"
**Pre-call hypothesis:** [1-2 sentences]
**The call's job:** [what to find out]
**Closed Lost context (if applicable):** [prior close month and reason, or omit the line]
**Seat math (Builder Code, if applicable):** [active users today, "anything over 20 total forces Enterprise", or omit the line]

**Pre-call scorecard:**
- Enterprise Need: [X]/10 -- [label]
- Pain we can solve: [X]/10 -- [label]
- Potential Champion: [X]/10 -- [label]
- ICP Fit: [X]/10 -- [label]

---

## Discovery (about 10 min)

### Question 1 -- [Topic] . Qualifying: [Pillar]

> "[Question]"

**Listen for:**
- Good: [qualified signal]
- Bad: [not-qualified signal]

**Notes:** ______________________________________________

[repeat for each question]

---

## After the Call

**If qualified:** bring in an AE and book the 30 minutes before you hang up -- get the next meeting on the calendar live. Then give the AE the handoff summary [Builder Code: stage, next-stage target, blockers, engineering path, VPC signal. Builder Content: Visual CMS to Optimization to Localization read].

**If not qualified, point them somewhere useful before you go:**
- [If a Builder Code need they can self-serve, point them to the self-serve path]
- [Relevant docs and resources to keep exploring]
- [Offer to revisit when there's a real project / compelling event]
- Recycle the lead in HubSpot

**Either way, set the next step before the call ends -- and if there's any path forward, get it on the calendar live.**

---

## Live Scorecard Update

| Pillar | Pre-call | Post-call |
|---|---|---|
| Enterprise Need | [X]/10 | ___/10 |
| Pain we can solve | [X]/10 | ___/10 |
| Potential Champion | [X]/10 | ___/10 |
| ICP Fit | [X]/10 | ___/10 |

**Number landed (the metric):** ______________________________________________

**Calendared next step:** [ ] Yes, on calendar   [ ] Discussed only (not yet a real next step)

**Final call:**
- [ ] Qualified
- [ ] Check with team
- [ ] Disqualify

**Why this call:** ______________________________________________

Reply with valid JSON only, no markdown fences: {"worksheetMarkdown": "..."}`;

export async function generateWorksheet(research: IntroCallResearch, scorecard: IntroCallScorecard, checkpoint: IntroCallCheckpoint): Promise<string> {
  const parsed = await completeJsonWithRetry<{ worksheetMarkdown: string }>({
    systemPrompt: `${INTRO_CALL_REFERENCE}\n\n${WORKSHEET_CONTRACT}`,
    input: `${buildResearchBlock(research, scorecard)}\n\nAgreed pain score: ${checkpoint.painScore}/10 -- ${checkpoint.painLabel}\nAgreed champion score: ${checkpoint.championScore}/10 -- ${checkpoint.championLabel}`,
    maxOutputTokens: 3000,
  });
  return String(parsed.worksheetMarkdown ?? "");
}
