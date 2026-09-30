// Demo mode: made-up leads run through the real pipeline in memory, so the board,
// records, and receipts show exactly what the rules decide. Runs in the browser;
// nothing touches the database, the CRM, or any provider.
import { z } from "zod";

import demoJson from "../../../fixtures/demo-cases.json";
import { DEMO_ID_PREFIX } from "../../../shared/demo.js";
import type {
  BoardResult,
  BoardTab,
  EngagementDetail,
  ReceiptDetail,
} from "../../../shared/pa-views.js";
import { wallTimeToInstant, zonedParts } from "../clocks/index.js";
import {
  FixtureCrmAdapter,
  fixtureCaseSchema,
  type FixtureCase,
} from "../crm/fixture-adapter.js";
import { runPipeline } from "../pipeline/runner.js";
import type { Assessor, Drafter, PipelineDeps } from "../pipeline/types.js";
import { seedRelease } from "../playbook/release.js";
import {
  devProfiles,
  registerRelease,
  seedSyntheticProfiles,
  signDraft,
} from "../replay/index.js";
import { MemoryRepository } from "../repo/memory.js";
import {
  buildEngagementDetail,
  buildInboundBoard,
  buildReceiptDetail,
  type Viewer,
} from "../views/inbound.js";

export const DEMO_SOURCE = "demo";
const DEMO_VIEWER_ID = "demo-viewer";

const demoCaseSchema = fixtureCaseSchema.omit({ expected: true }).extend({
  minutes_ago: z.number().int().min(0),
  assessment: z.record(z.string(), z.unknown()),
  draft: z.record(z.string(), z.unknown()).optional(),
});

const demoFileSchema = z.object({
  note: z.string(),
  anchor: z.object({
    timezone: z.string(),
    hour: z.number().int(),
    minute: z.number().int(),
  }),
  cases: z.array(demoCaseSchema).min(1),
});

const demoFile = demoFileSchema.parse(demoJson);

/** The most recent weekday at the anchor wall time (11:30 AM Pacific) at or before `now`. */
export function demoAnchor(now: Date): Date {
  const { timezone, hour, minute } = demoFile.anchor;
  const parts = zonedParts(now, timezone);
  let daysBack = parts.hour * 60 + parts.minute >= hour * 60 + minute ? 0 : 1;
  for (;;) {
    const civil = new Date(
      Date.UTC(parts.year, parts.month - 1, parts.day - daysBack),
    );
    const isoWeekday = ((civil.getUTCDay() + 6) % 7) + 1;
    if (isoWeekday <= 5) {
      return wallTimeToInstant(
        civil.getUTCFullYear(),
        civil.getUTCMonth() + 1,
        civil.getUTCDate(),
        hour,
        minute,
        timezone,
      );
    }
    daysBack += 1;
  }
}

export interface DemoData {
  anchor: Date;
  timezone: string;
  leadCount: number;
  failures: string[];
  board(tab: BoardTab, state: string | null): Promise<BoardResult>;
  engagement(id: string): Promise<EngagementDetail | null>;
  receipt(id: string): Promise<ReceiptDetail | null>;
}

export async function buildDemoData(options: { now: Date }): Promise<DemoData> {
  const anchor = demoAnchor(options.now);
  const repo = new MemoryRepository();
  let counter = 0;
  // Sequential ids keep demo links stable across reloads.
  const newId = () => `${DEMO_ID_PREFIX}${String(++counter).padStart(6, "0")}`;
  const cases = [...demoFile.cases].sort(
    (a, b) => b.minutes_ago - a.minutes_ago,
  );
  let current = new Date(anchor.getTime() - cases[0].minutes_ago * 60_000);
  const now = () => current;

  await registerRelease(repo, seedRelease, "shadow", current);
  await seedSyntheticProfiles(repo, {
    linkUserId: DEMO_VIEWER_ID,
    now: current,
    newId,
  });

  const assessments = new Map(cases.map((item) => [item.id, item.assessment]));
  const assessor: Assessor = {
    source: "demo_fixture",
    async assess({ inbox }) {
      return inbox.source === DEMO_SOURCE
        ? (assessments.get(inbox.externalId) ?? null)
        : null;
    },
  };
  const drafts = new Map(cases.map((item) => [item.id, item.draft ?? null]));
  const drafter: Drafter = {
    source: "demo_fixture",
    async draft({ inbox, ownerFirstName }) {
      if (inbox.source !== DEMO_SOURCE) return null;
      const raw = drafts.get(inbox.externalId);
      return raw ? signDraft(raw, ownerFirstName) : null;
    },
  };
  const crmCases: FixtureCase[] = cases.map(({ id, submission, crm }) => ({
    id,
    submission,
    crm,
    expected: {},
  }));
  const deps: PipelineDeps = {
    repo,
    crm: new FixtureCrmAdapter(crmCases, now),
    release: seedRelease,
    assessor,
    drafter,
    now,
    newId,
    devPool: devProfiles.dev_pool,
    mode: "shadow",
  };

  const failures: string[] = [];
  for (const item of cases) {
    current = new Date(anchor.getTime() - item.minutes_ago * 60_000);
    const receivedAt = current.toISOString();
    const { record } = await repo.insertInboxIfAbsent({
      id: newId(),
      source: DEMO_SOURCE,
      externalId: item.id,
      receivedAt,
      signatureOk: true,
      payload: {
        ...item.submission,
        form_id: "demo-contact-sales",
        submitted_at: receivedAt,
      },
      status: "pending",
      attempts: 0,
      lastError: null,
      nextAttemptAt: null,
      version: 1,
      createdAt: receivedAt,
      updatedAt: receivedAt,
    });
    const run = await runPipeline(record.id, deps);
    if (run.status !== "done")
      failures.push(`${item.id}: ${run.error ?? run.status}`);
  }
  current = anchor;

  const viewer: Viewer = { userId: DEMO_VIEWER_ID, canReplay: false };
  return {
    anchor,
    timezone: demoFile.anchor.timezone,
    leadCount: cases.length,
    failures,
    board: (tab, state) =>
      buildInboundBoard({
        repo,
        release: seedRelease,
        viewer,
        tab,
        state,
        now: anchor,
      }),
    engagement: (id) =>
      buildEngagementDetail({
        repo,
        release: seedRelease,
        viewer,
        engagementId: id,
        now: anchor,
      }),
    receipt: (id) =>
      buildReceiptDetail({ repo, release: seedRelease, receiptId: id }),
  };
}
