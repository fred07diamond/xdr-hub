import { resourceEffectiveContext, resourceGet } from "@agent-native/core/resources";

// Shared brand-voice guidelines for any outbound outreach copy this
// workspace's apps generate — today: Prospecting Hub's email/LinkedIn
// drafts (draft-outreach.ts) and LinkedIn Agent's connection notes
// (draft-profile.ts). Each app keeps its own grounding data (personas +
// Sales Library docs vs. an uploaded ICP + live profile activity) and its
// own generation logic — this is deliberately just the shared TONE layer,
// not a merge of either app's actual drafting code, per Fred's explicit
// "shared voice doc" choice over a deeper cross-app integration.
//
// Read via the framework's documented workspace-resource inheritance
// (`context/<slug>.md`, editable centrally from Dispatch Resources without
// a code deploy — see the `agent-resources` framework doc) so anyone can
// tune the voice later without touching either app's code, with a sensible
// built-in default for a workspace that hasn't customized it yet. Either
// way, every app calling this gets the exact same text.
const OUTREACH_VOICE_RESOURCE_PATH = "context/outreach-voice.md";

const DEFAULT_OUTREACH_VOICE_GUIDELINES = `
- Sound like a real person who did their homework, not a template. Reference something specific and true about the recipient's role or company — never generic flattery ("impressive background", "love what you're doing").
- Keep it short. A LinkedIn note is a sentence or two; an email is a few short paragraphs, not a pitch deck.
- One clear, low-pressure ask. Don't stack multiple asks or over-explain the ask.
- No corporate filler: skip "I hope this email finds you well", "I wanted to reach out because", "in today's fast-paced world", excessive exclamation points, or emoji.
- Never invent a fact about the person or their company that wasn't actually supplied as input.
- Casual, direct sign-off — not stiff "Best regards," formality.
`.trim();

// Never throws — a resource-lookup failure (no workspace context, resource
// genuinely absent, a transient DB hiccup) must never block outreach
// drafting; falls back to the built-in default guidelines instead.
export async function getOutreachVoiceGuidelines(userEmail: string, orgId?: string | null): Promise<string> {
  try {
    const effective = await resourceEffectiveContext(userEmail, OUTREACH_VOICE_RESOURCE_PATH, {
      orgId: orgId ?? undefined,
    });
    if (effective.effectiveResource) {
      const resource = await resourceGet(effective.effectiveResource.id);
      if (resource?.content?.trim()) return resource.content.trim();
    }
  } catch {
    // fall through to the default below
  }
  return DEFAULT_OUTREACH_VOICE_GUIDELINES;
}
