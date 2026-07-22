import { eq, isNull, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { messagingCanvases, messagingEdges, messagingNodes } from "../db/schema.js";

// Bump the version suffix to force a reseed of system templates.
export const SYSTEM_CANVAS_IDS = {
  account:  "sys-canvas-account-v3",
  role:     "sys-canvas-role-v3",
  prospect: "sys-canvas-prospect-v3",
  blank:    "sys-canvas-blank-v3",
} as const;

type SystemSlug = keyof typeof SYSTEM_CANVAS_IDS;

type NodeDef = {
  key: string;
  type: string;
  title: string;
  positionX: number;
  positionY: number;
  tone?: string;
  valueProps?: string;
  phrasesToUse?: string;
  phrasesToAvoid?: string;
  exampleNotes?: string;
  notes?: string;
};

type EdgeDef = { sourceKey: string; targetKey: string };

type TemplateDef = {
  slug: SystemSlug;
  name: string;
  nodes: NodeDef[];
  edges: EdgeDef[];
};

const SYSTEM_TEMPLATES: TemplateDef[] = [
  // ── Account-Based (trickle-down: Company → org-level messaging → role branch) ─
  {
    slug: "account",
    name: "Account-Based",
    nodes: [
      {
        key: "company",
        type: "company",
        title: "Target Company",
        positionX: 80, positionY: 480,
        notes: "",
      },
      {
        key: "voice",
        type: "tone",
        title: "Voice & Angle",
        positionX: 380, positionY: 60,
        tone: "Peer-to-peer. Specific and direct. Lead with something real you noticed — a hire, a launch, a public post. Skip the preamble. Sound like someone who understands their world, not someone reading from a script.",
        valueProps: "Efficiency at scale. Outcomes tied to quota, headcount, or cost reduction. Fast time to value with minimal lift from their team.",
      },
      {
        key: "phrases",
        type: "phrase_rule",
        title: "Phrase Rules",
        positionX: 380, positionY: 280,
        phrasesToUse: "worth a look, pipeline, GTM motion, scaling outbound, team efficiency, rep productivity, worth a conversation",
        phrasesToAvoid: "I wanted to reach out, hope this finds you well, synergy, disruptive, game-changing, just circling back, touching base, I'd love to connect, mutually beneficial, excited to share",
      },
      {
        key: "example",
        type: "example",
        title: "Example Note",
        positionX: 380, positionY: 490,
        exampleNotes: "Hi [Name] — saw [Company] just opened 3 BDR reqs. We help teams at your stage add pipeline without growing the team. Worth a look?",
      },
      {
        key: "role",
        type: "role",
        title: "VP Sales / CRO",
        positionX: 380, positionY: 700,
        tone: "Lead with quota impact and pipeline coverage. They care about numbers, not process. Reference headcount growth, competitive pressure, or forecast predictability if visible.",
        notes: "Connect every point back to revenue. They respond to peer social proof ('teams like yours at Series B') and specific metrics, not feature lists.",
        phrasesToUse: "quota, pipeline coverage, rep ramp, deal velocity, outbound capacity, revenue impact",
        phrasesToAvoid: "solution, best-in-class, excited to share, would love to tell you more",
      },
      {
        key: "role-voice",
        type: "tone",
        title: "VP Sales Voice",
        positionX: 680, positionY: 600,
        tone: "Numbers-first, one ask only. 'We helped [Company] add X pipeline with Y reps' is the format. Everything else is noise.",
        valueProps: "More pipeline without more headcount. Faster rep ramp time. Predictable, scalable outbound.",
      },
      {
        key: "role-phrases",
        type: "phrase_rule",
        title: "Sales Buyer Phrases",
        positionX: 680, positionY: 790,
        phrasesToUse: "pipeline capacity, outbound coverage, ramp time, revenue impact, deal velocity, quota attainment",
        phrasesToAvoid: "I think you'd be interested, would love to connect, per my last email, hope you had a great weekend, just following up",
      },
      {
        key: "role-example",
        type: "example",
        title: "VP Sales Example",
        positionX: 680, positionY: 980,
        exampleNotes: "Hi [Name] — [Company] just hired 4 new AEs. We help growing teams hit ramp targets 40% faster. Worth 15 minutes to see if it's relevant?",
      },
    ],
    edges: [
      { sourceKey: "company",     targetKey: "voice"        },
      { sourceKey: "company",     targetKey: "phrases"      },
      { sourceKey: "company",     targetKey: "example"      },
      { sourceKey: "company",     targetKey: "role"         },
      { sourceKey: "role",        targetKey: "role-voice"   },
      { sourceKey: "role",        targetKey: "role-phrases" },
      { sourceKey: "role",        targetKey: "role-example" },
    ],
  },

  // ── Role-Based (job title as root, pain-centric trickle-down) ────────────────
  {
    slug: "role",
    name: "Role-Based",
    nodes: [
      {
        key: "jobtitle",
        type: "role",
        title: "Job Title / Function",
        positionX: 80, positionY: 300,
        notes: "Put the specific job title here — e.g. 'Director of Product', 'Software Engineer', 'Head of Revenue Operations'. This is who you're messaging across many accounts. Everything below refines how you speak to this role.",
        tone: "Empathetic and role-specific. Write like someone who has held that job and knows the daily frustrations. Don't lead with your product — lead with their pain.",
        phrasesToUse: "a lot of [role]s I talk to, teams your size, at the stage you're at",
      },
      {
        key: "voice",
        type: "tone",
        title: "Voice",
        positionX: 380, positionY: 60,
        tone: "Empathetic and role-specific. Write like someone who has held that job and knows the daily frustrations. Don't lead with your product — lead with their pain. Make them feel understood in the first sentence.",
        valueProps: "Time saved on their most recurring problem. Proof from peers in the same role. A clear outcome without jargon.",
      },
      {
        key: "phrases",
        type: "phrase_rule",
        title: "Phrase Rules",
        positionX: 380, positionY: 270,
        phrasesToUse: "a lot of [role]s I talk to, teams your size, at the stage you're at, the thing that usually gets teams stuck, most [role]s tell us",
        phrasesToAvoid: "revolutionary, innovative, seamlessly, I'd love to connect, I think you'd be a great fit, per our conversation, hoping to reconnect",
      },
      {
        key: "pain",
        type: "role",
        title: "Their #1 Pain",
        positionX: 380, positionY: 480,
        notes: "Name the single biggest frustration for this role — not a feature you solve, but the symptom they feel every week. Everything connects back to this one pain.",
        tone: "Specific and empathetic. Call out the exact thing that makes their job hard. Vague 'challenges' don't resonate — the specific symptom does.",
        phrasesToUse: "the thing we hear most from [role]s, the problem before they find us, the part that takes the most time",
      },
      {
        key: "example",
        type: "example",
        title: "Example Note",
        positionX: 380, positionY: 700,
        exampleNotes: "Hi [Name] — a lot of [role]s I talk to are stuck [specific pain]. We help teams like yours [outcome] in [timeframe]. Worth a look?",
      },
      {
        key: "pain-voice",
        type: "tone",
        title: "Pain-Led Voice",
        positionX: 680, positionY: 380,
        tone: "Zero in on the single frustration. First sentence: name their pain. Second sentence: outcome you produce. Third: one ask.",
        valueProps: "Solve the one thing they complain about most. Fast proof, no long demo required.",
      },
      {
        key: "pain-example",
        type: "example",
        title: "Pain-Led Example",
        positionX: 680, positionY: 580,
        exampleNotes: "Hi [Name] — [role]s your size usually tell us [specific pain] is the thing eating the most time. We cut that in half for [Company A] and [Company B]. Worth comparing notes?",
      },
    ],
    edges: [
      { sourceKey: "jobtitle", targetKey: "voice"        },
      { sourceKey: "jobtitle", targetKey: "phrases"      },
      { sourceKey: "jobtitle", targetKey: "pain"         },
      { sourceKey: "jobtitle", targetKey: "example"      },
      { sourceKey: "pain",     targetKey: "pain-voice"   },
      { sourceKey: "pain",     targetKey: "pain-example" },
    ],
  },

  // ── Prospect-Driven (company → specific role → signal-led messaging) ──────────
  {
    slug: "prospect",
    name: "Prospect-Driven",
    nodes: [
      {
        key: "company",
        type: "company",
        title: "Target Company",
        positionX: 80, positionY: 380,
        notes: "",
      },
      {
        key: "role",
        type: "role",
        title: "Their Title",
        positionX: 380, positionY: 280,
        notes: "The specific job title of the person you're messaging. What does this title mean for your angle? What are they responsible for? What would make them look good or bad internally?",
        tone: "Ultra-personalized. The first sentence makes them feel like you wrote this for them. Reference something real — not their company or title, but something THEY said or did.",
      },
      {
        key: "phrases",
        type: "phrase_rule",
        title: "Phrase Rules",
        positionX: 380, positionY: 510,
        phrasesToUse: "noticed your post on, saw that you, given the [recent event], as you're [navigating/scaling/launching], sounds like you're in the middle of",
        phrasesToAvoid: "I came across your profile, I think we could work well together, I'd love to connect, mutually beneficial, hope this finds you well, I wanted to reach out",
      },
      {
        key: "signal",
        type: "role",
        title: "Signal → Angle",
        positionX: 680, positionY: 160,
        notes: "Match your opening angle to the signal you found:\n• Funding round → scale pains, build vs. buy pressure\n• New AE/BDR hires → outbound ramp and coverage\n• Job change → making their mark fast, proving the new role\n• Post or talk → belief they publicly hold\n• Product launch → the upstream problem it creates",
        tone: "Lead with the signal in the first 5 words. Make the connection feel obvious.",
      },
      {
        key: "voice",
        type: "tone",
        title: "Signal-First Voice",
        positionX: 680, positionY: 390,
        tone: "Open with the specific signal. One sentence on why it caught your attention. One sentence on the outcome you create. One ask — that's it.",
        valueProps: "Make them feel seen. The value is in the specificity — you did the homework they expect everyone to skip.",
      },
      {
        key: "example",
        type: "example",
        title: "Example Note",
        positionX: 680, positionY: 600,
        exampleNotes: "Hi [Name] — given the Series B you just closed, teams at your stage usually hit [specific scaling pain] fast. We've helped [Company A] and [Company B] navigate it. Interested in comparing notes?",
      },
    ],
    edges: [
      { sourceKey: "company", targetKey: "role"    },
      { sourceKey: "role",    targetKey: "signal"  },
      { sourceKey: "role",    targetKey: "phrases" },
      { sourceKey: "role",    targetKey: "voice"   },
      { sourceKey: "role",    targetKey: "example" },
    ],
  },

  // ── Blank ─────────────────────────────────────────────────────────────────────
  {
    slug: "blank",
    name: "Blank",
    nodes: [
      {
        key: "jobtitle",
        type: "role",
        title: "Job Title / Function",
        positionX: 200, positionY: 200,
        notes: "Start here: put the job title or function you're targeting. Branch off tone, phrase rules, and example notes to build your messaging strategy.",
      },
    ],
    edges: [],
  },
];

export async function seedSystemCanvases(db: ReturnType<typeof getDb>): Promise<void> {
  for (const template of SYSTEM_TEMPLATES) {
    const canvasId = SYSTEM_CANVAS_IDS[template.slug];

    const existing = await db
      .select({ id: messagingCanvases.id })
      .from(messagingCanvases)
      .where(eq(messagingCanvases.id, canvasId))
      .limit(1);

    if (existing.length > 0) continue;

    const now = new Date().toISOString();

    try {
      await db.insert(messagingCanvases).values({
        id: canvasId,
        name: template.name,
        templateSlug: template.slug,
        isSystem: 1,
        ownerEmail: null,
        createdAt: now,
        updatedAt: now,
      });

      // Insert nodes and build key → generated ID map for edge wiring
      const keyToId = new Map<string, string>();
      for (const n of template.nodes) {
        const nodeId = nanoid();
        keyToId.set(n.key, nodeId);
        await db.insert(messagingNodes).values({
          id: nodeId,
          type: n.type,
          title: n.title,
          ownerEmail: null,
          canvasId,
          positionX: n.positionX,
          positionY: n.positionY,
          tone: n.tone ?? null,
          valueProps: n.valueProps ?? null,
          phrasesToUse: n.phrasesToUse ?? null,
          phrasesToAvoid: n.phrasesToAvoid ?? null,
          exampleNotes: n.exampleNotes ?? null,
          notes: n.notes ?? null,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Insert edges using the key → ID map
      for (const e of template.edges) {
        const sourceId = keyToId.get(e.sourceKey);
        const targetId = keyToId.get(e.targetKey);
        if (!sourceId || !targetId) continue;
        await db.insert(messagingEdges).values({
          id: nanoid(),
          sourceId,
          targetId,
          ownerEmail: null,
          canvasId,
          createdAt: now,
        });
      }
    } catch {
      // A concurrent request already inserted this canvas — silently skip.
      return;
    }
  }
}

/**
 * Ensure a user has at least one canvas. If they have existing nodes with no
 * canvas_id, create a "My Canvas" for them and backfill those nodes into it.
 */
export async function ensureUserCanvas(
  ownerEmail: string,
  db: ReturnType<typeof getDb>,
): Promise<string> {
  const existing = await db
    .select({ id: messagingCanvases.id })
    .from(messagingCanvases)
    .where(and(eq(messagingCanvases.ownerEmail, ownerEmail), eq(messagingCanvases.isSystem, 0)))
    .limit(1);

  if (existing[0]) return existing[0].id;

  // Create default canvas
  const canvasId = nanoid();
  const now = new Date().toISOString();
  await db.insert(messagingCanvases).values({
    id: canvasId,
    name: "My Canvas",
    templateSlug: null,
    isSystem: 0,
    ownerEmail,
    createdAt: now,
    updatedAt: now,
  });

  // Backfill existing nodes that belong to this user but have no canvas_id
  await db
    .update(messagingNodes)
    .set({ canvasId, updatedAt: now })
    .where(and(eq(messagingNodes.ownerEmail, ownerEmail), isNull(messagingNodes.canvasId)));

  return canvasId;
}
