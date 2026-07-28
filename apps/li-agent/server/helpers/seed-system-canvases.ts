import { eq, isNull, and } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../db/index.js";
import { messagingCanvases, messagingEdges, messagingNodes } from "../db/schema.js";

// Bump the version suffix to force a reseed of system templates.
export const SYSTEM_CANVAS_IDS = {
  account:  "sys-canvas-account-v4",
  role:     "sys-canvas-role-v4",
  prospect: "sys-canvas-prospect-v4",
  blank:    "sys-canvas-blank-v4",
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
  // ── Account-Based ─────────────────────────────────────────────────────────────
  // Company is the root. Pain and buyer context branch first, then role-specific messaging.
  {
    slug: "account",
    name: "Account-Based",
    nodes: [
      {
        key: "company",
        type: "company",
        title: "Target Company",
        positionX: 80, positionY: 560,
        notes: "",
      },
      {
        key: "pain",
        type: "identify_pain",
        title: "Account Pain",
        positionX: 380, positionY: 100,
        notes: "What operational or strategic problem does this account type face that your solution fixes? Name the symptom they feel, not the category you sell into. Good: 'reps spend 3 hours/day on manual research.' Bad: 'sales productivity challenges.'",
      },
      {
        key: "metrics",
        type: "metrics",
        title: "Proof Points",
        positionX: 680, positionY: 100,
        notes: "What specific, measurable outcomes do you deliver? Lead with numbers: time saved, pipeline added, cost cut, ramp time reduced. These go in the note body as social proof. Examples: 'cut ramp time 40%', 'added 2x pipeline with same headcount', 'saved 8 hrs/week per rep'.",
      },
      {
        key: "economic-buyer",
        type: "economic_buyer",
        title: "Economic Buyer",
        positionX: 380, positionY: 330,
        notes: "Who controls budget for this purchase at your target accounts? Name the title. Describe what they care about most — quota attainment, cost efficiency, headcount, board reporting? Knowing their lens shapes every word you write.",
      },
      {
        key: "champion",
        type: "champion",
        title: "Internal Champion",
        positionX: 680, positionY: 330,
        notes: "Who at this account would benefit most from your solution and would advocate for it internally? Usually the person doing the painful work daily — not the budget holder. They sell for you once you've earned their trust. Lead with their pain, not the EB's.",
      },
      {
        key: "competition",
        type: "competition",
        title: "Competition",
        positionX: 380, positionY: 560,
        notes: "What is this account type likely using today — spreadsheets, a legacy tool, a competitor? Understanding the status quo shapes your angle. Don't attack it directly in the note; instead acknowledge the incumbent implicitly by describing the gap it leaves.",
      },
      {
        key: "voice",
        type: "tone",
        title: "Voice & Angle",
        positionX: 380, positionY: 790,
        tone: "Peer-to-peer. Specific and direct. Lead with something real you noticed — a hire, a launch, a public post. Skip the preamble. Sound like someone who understands their world, not someone reading from a script.",
        valueProps: "Outcomes tied to quota, headcount, or cost reduction. Fast time to value with minimal lift from their team.",
      },
      {
        key: "phrases",
        type: "phrase_rule",
        title: "Phrase Rules",
        positionX: 680, positionY: 760,
        phrasesToUse: "worth a look, pipeline, GTM motion, scaling outbound, team efficiency, rep productivity, worth a conversation",
        phrasesToAvoid: "I wanted to reach out, hope this finds you well, synergy, disruptive, game-changing, just circling back, touching base, I'd love to connect, mutually beneficial, excited to share",
      },
      {
        key: "role",
        type: "role",
        title: "VP Sales / CRO",
        positionX: 380, positionY: 1020,
        tone: "Lead with quota impact and pipeline coverage. They care about numbers, not process. Reference headcount growth, competitive pressure, or forecast predictability if visible.",
        notes: "Connect every point back to revenue. They respond to peer social proof ('teams like yours at Series B') and specific metrics, not feature lists.",
        phrasesToUse: "quota, pipeline coverage, rep ramp, deal velocity, outbound capacity, revenue impact",
        phrasesToAvoid: "solution, best-in-class, excited to share, would love to tell you more",
      },
      {
        key: "role-voice",
        type: "tone",
        title: "VP Sales Voice",
        positionX: 680, positionY: 960,
        tone: "Numbers-first, one ask only. 'We helped [Company] add X pipeline with Y reps' is the format. Everything else is noise.",
        valueProps: "More pipeline without more headcount. Faster rep ramp time. Predictable, scalable outbound.",
      },
      {
        key: "role-example",
        type: "example",
        title: "VP Sales Example",
        positionX: 680, positionY: 1140,
        exampleNotes: "Hi [Name] — [Company] just hired 4 new AEs. We help growing teams hit ramp targets 40% faster without adding ops headcount. Worth 15 minutes?",
      },
    ],
    edges: [
      { sourceKey: "company",       targetKey: "pain"         },
      { sourceKey: "company",       targetKey: "economic-buyer" },
      { sourceKey: "company",       targetKey: "competition"  },
      { sourceKey: "company",       targetKey: "voice"        },
      { sourceKey: "company",       targetKey: "role"         },
      { sourceKey: "pain",          targetKey: "metrics"      },
      { sourceKey: "economic-buyer", targetKey: "champion"    },
      { sourceKey: "voice",         targetKey: "phrases"      },
      { sourceKey: "role",          targetKey: "role-voice"   },
      { sourceKey: "role",          targetKey: "role-example" },
    ],
  },

  // ── Role-Based ────────────────────────────────────────────────────────────────
  // A specific job title is the root. Pain → proof → evaluation criteria branch off it.
  {
    slug: "role",
    name: "Role-Based",
    nodes: [
      {
        key: "jobtitle",
        type: "role",
        title: "Job Title / Function",
        positionX: 80, positionY: 380,
        notes: "Put the specific job title here — e.g. 'Director of Product', 'Head of Revenue Operations', 'VP Engineering'. This is who you're messaging across many accounts. Everything below refines how you speak to them.",
        tone: "Empathetic and role-specific. Write like someone who has held that job. Lead with their pain, not your product.",
        phrasesToUse: "a lot of [role]s I talk to, teams your size, at the stage you're at",
      },
      {
        key: "pain",
        type: "identify_pain",
        title: "Their #1 Pain",
        positionX: 380, positionY: 100,
        notes: "Name the single biggest frustration for this role — the symptom they feel every week, not a feature category you solve. Make it specific enough that they'd say 'that's exactly it.' Vague: 'workflow inefficiency.' Specific: 'they spend 3 hrs/day updating dashboards nobody reads.'",
      },
      {
        key: "metrics",
        type: "metrics",
        title: "Proof Points",
        positionX: 680, positionY: 60,
        notes: "What measurable outcomes does your solution deliver for this role? Translate abstract value into role-specific numbers: time saved per week, reports automated, deals accelerated. Concrete metrics give them something to repeat in their internal pitch.",
      },
      {
        key: "decision-criteria",
        type: "decision_criteria",
        title: "Decision Criteria",
        positionX: 680, positionY: 300,
        notes: "What does this role evaluate when buying? Technical fit, integration complexity, ease of rollout, proof of ROI, peer adoption, vendor trust? Knowing their criteria lets you pre-answer objections in the note. A CFO-influenced buy weights ROI; a technical lead weights integrations.",
      },
      {
        key: "voice",
        type: "tone",
        title: "Voice",
        positionX: 380, positionY: 360,
        tone: "Empathetic and role-specific. Write like someone who has held that job and knows the daily frustrations. Don't lead with your product — lead with their pain. Make them feel understood in the first sentence.",
        valueProps: "Time saved on their most recurring problem. Proof from peers in the same role. A clear outcome without jargon.",
      },
      {
        key: "phrases",
        type: "phrase_rule",
        title: "Phrase Rules",
        positionX: 380, positionY: 600,
        phrasesToUse: "a lot of [role]s I talk to, the thing that usually gets teams stuck, most [role]s tell us, teams at your stage",
        phrasesToAvoid: "revolutionary, innovative, seamlessly, I'd love to connect, I think you'd be a great fit, per our conversation, hoping to reconnect",
      },
      {
        key: "example",
        type: "example",
        title: "Example Note",
        positionX: 380, positionY: 820,
        exampleNotes: "Hi [Name] — a lot of [role]s I talk to are stuck [specific pain]. We've helped teams like [Company A] [measurable outcome] without [common objection]. Worth a look?",
      },
      {
        key: "pain-example",
        type: "example",
        title: "Pain-Led Example",
        positionX: 680, positionY: 480,
        exampleNotes: "Hi [Name] — [role]s your size usually tell us [specific pain] is the thing eating the most time. We cut that in half for [Company A] and [Company B]. Worth comparing notes?",
      },
    ],
    edges: [
      { sourceKey: "jobtitle", targetKey: "pain"            },
      { sourceKey: "jobtitle", targetKey: "voice"           },
      { sourceKey: "jobtitle", targetKey: "phrases"         },
      { sourceKey: "jobtitle", targetKey: "example"         },
      { sourceKey: "pain",     targetKey: "metrics"         },
      { sourceKey: "pain",     targetKey: "decision-criteria" },
      { sourceKey: "pain",     targetKey: "pain-example"    },
    ],
  },

  // ── Prospect-Driven ───────────────────────────────────────────────────────────
  // Company context leads into a specific role. Signal-driven, with buyer context nodes.
  {
    slug: "prospect",
    name: "Prospect-Driven",
    nodes: [
      {
        key: "company",
        type: "company",
        title: "Target Company",
        positionX: 80, positionY: 440,
        notes: "",
      },
      {
        key: "role",
        type: "role",
        title: "Their Title",
        positionX: 380, positionY: 300,
        notes: "The specific job title of the person you're messaging. What are they responsible for? What would make them look good or bad internally? What's their relationship to budget?",
        tone: "Ultra-personalized. The first sentence makes them feel like you wrote this for them. Reference something real — something THEY said or did, not just their company.",
      },
      {
        key: "champion",
        type: "champion",
        title: "Champion Signals",
        positionX: 680, positionY: 100,
        notes: "Does this person show champion signals? Look for: they've publicly praised a problem you solve, they've shared content in your space, they've recently changed roles and need a win, they're actively hiring for a team that would use your product. Champion signals mean you can skip the education and go straight to the ask.",
      },
      {
        key: "pain",
        type: "identify_pain",
        title: "Signal-Based Pain",
        positionX: 680, positionY: 320,
        notes: "What pain does their recent activity signal? Map signals to pains:\n• Funding round → scale pressure, build vs. buy tradeoff\n• AE/BDR hiring → ramp speed, outbound capacity\n• Job change → proving ROI fast in the new role\n• Post on a problem topic → they're actively feeling it\n• New product launch → upstream team friction it creates",
      },
      {
        key: "metrics",
        type: "metrics",
        title: "Proof to Lead With",
        positionX: 980, positionY: 320,
        notes: "Given their signal, which of your proof points lands hardest? Match the metric to the pain: funding → how fast you drive ROI; job change → how quickly teams see results; hiring → how you reduce ramp time. One specific number beats three vague claims.",
      },
      {
        key: "competition",
        type: "competition",
        title: "Status Quo",
        positionX: 680, positionY: 540,
        notes: "What is this person likely using today — or doing manually — to solve the problem? The status quo is your real competition. Don't attack it by name. Instead, reference the gap it leaves: 'most teams at this stage are still doing X manually, which means...'",
      },
      {
        key: "phrases",
        type: "phrase_rule",
        title: "Signal Phrases",
        positionX: 680, positionY: 760,
        phrasesToUse: "noticed your post on, saw that you, given the [recent event], as you're [navigating/scaling/launching], sounds like you're in the middle of",
        phrasesToAvoid: "I came across your profile, I think we could work well together, I'd love to connect, mutually beneficial, hope this finds you well, I wanted to reach out",
      },
      {
        key: "voice",
        type: "tone",
        title: "Signal-First Voice",
        positionX: 380, positionY: 580,
        tone: "Open with the specific signal in the first 5 words. One sentence on why it caught your attention. One sentence on the outcome you create. One ask — that's it. Never summarize what you sell before you've earned their attention.",
        valueProps: "Make them feel seen. The value is in the specificity — you did the homework they expect everyone to skip.",
      },
      {
        key: "example",
        type: "example",
        title: "Example Note",
        positionX: 380, positionY: 800,
        exampleNotes: "Hi [Name] — given the Series B you just closed, teams at your stage usually hit [specific scaling pain] fast. We've helped [Company A] and [Company B] navigate it without adding headcount. Worth 15 min?",
      },
    ],
    edges: [
      { sourceKey: "company",    targetKey: "role"       },
      { sourceKey: "role",       targetKey: "champion"   },
      { sourceKey: "role",       targetKey: "pain"       },
      { sourceKey: "role",       targetKey: "voice"      },
      { sourceKey: "pain",       targetKey: "metrics"    },
      { sourceKey: "pain",       targetKey: "competition" },
      { sourceKey: "pain",       targetKey: "phrases"    },
      { sourceKey: "voice",      targetKey: "example"    },
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
        positionX: 160, positionY: 260,
        notes: "Start here: put the job title or function you're targeting. Branch off pain, metrics, voice, phrase rules, and example notes to build your strategy.",
      },
      {
        key: "pain",
        type: "identify_pain",
        title: "Identify Pain",
        positionX: 500, positionY: 260,
        notes: "What is the single biggest frustration this role faces that your solution addresses? Be specific — name the symptom, not the category.",
      },
    ],
    edges: [
      { sourceKey: "jobtitle", targetKey: "pain" },
    ],
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
