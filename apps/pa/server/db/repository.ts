// Drizzle queries: https://orm.drizzle.team/docs/select, /docs/insert#on-conflict-do-nothing,
// /docs/transactions. Team-scoped pa_ records; agent raw DB tools are off (D28).
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";

import { OPEN_STATES, type EngagementState } from "../core/objects/index.js";
import {
  VersionConflictError,
  type AccountRecord,
  type AssessmentRecord,
  type ContactRecord,
  type EngagementRecord,
  type EventRecord,
  type InboxRecord,
  type PaRepository,
  type ReceiptRecord,
  type ReleaseRecord,
  type ScorecardRecord,
  type DraftRecord,
  type DecisionRecord,
  type HandbookDocRecord,
  type HandbookRevisionRecord,
  type SubmissionRecord,
  type UserProfileRecord,
  type ApprovalRecord,
  type ChangeItemRecord,
  type ChangeRecord,
  type ChangeStatus,
  type ReleaseLabelRecord,
  type SuggestionAudience,
  type SuggestionRecord,
  type SuggestionStatus,
} from "../core/repo/types.js";
import { getDb, schema } from "./index.js";
import { decodeJson, encodeJson } from "./json.js";

type Db = ReturnType<typeof getDb>;
type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Executor = Db | Tx;

const {
  paReleaseLabels,
  paPlaybookChanges,
  paPlaybookChangeItems,
  paPlaybookApprovals,
  paSuggestions,
  paAccounts,
  paAssessments,
  paContacts,
  paEngagements,
  paEvents,
  paInbox,
  paPlaybookReleases,
  paReceipts,
  paScorecards,
  paDrafts,
  paDecisions,
  paHandbookDocs,
  paHandbookRevisions,
  paSubmissions,
  paUserProfiles,
} = schema;

const asInbox = (raw: typeof paInbox.$inferSelect): InboxRecord => {
  const row = decodeJson("inbox", raw) as any;
  return {
    ...row,
    status: row.status as InboxRecord["status"],
    payload: row.payload as Record<string, unknown>,
  };
};
const asSubmission = (
  raw: typeof paSubmissions.$inferSelect,
): SubmissionRecord => {
  const row = decodeJson("submissions", raw) as any;
  return {
    ...row,
    fields: row.fields as Record<string, unknown>,
    flags: row.flags as SubmissionRecord["flags"],
  };
};
const asAccount = (raw: typeof paAccounts.$inferSelect): AccountRecord => {
  const row = decodeJson("accounts", raw) as any;
  return {
    ...row,
    flags: row.flags as AccountRecord["flags"],
    firmographics: row.firmographics as AccountRecord["firmographics"],
  };
};
const asEngagement = (
  raw: typeof paEngagements.$inferSelect,
): EngagementRecord => {
  const row = decodeJson("engagements", raw) as any;
  // open_contact_id is maintained by this repository only; never hand it out.
  delete row.openContactId;
  return {
    ...row,
    reviewFlags: row.reviewFlags as EngagementRecord["reviewFlags"],
  };
};
const asEvent = (raw: typeof paEvents.$inferSelect): EventRecord => {
  const row = decodeJson("events", raw) as any;
  return {
    ...row,
    payload: row.payload as Record<string, unknown>,
  };
};
const asReceipt = (raw: typeof paReceipts.$inferSelect): ReceiptRecord => {
  const row = decodeJson("receipts", raw) as any;
  return {
    ...row,
    entryVersions: row.entryVersions as ReceiptRecord["entryVersions"],
    ruleResults: row.ruleResults as Record<string, unknown>,
    inputs: row.inputs as Record<string, unknown>,
    toolCalls: row.toolCalls as unknown[] | null,
  };
};
const asAssessment = (
  raw: typeof paAssessments.$inferSelect,
): AssessmentRecord => {
  const row = decodeJson("assessments", raw) as any;
  return {
    ...row,
    evidenceQuotes: row.evidenceQuotes as string[],
  };
};
const asDraft = (raw: typeof paDrafts.$inferSelect): DraftRecord => {
  const row = decodeJson("drafts", raw) as any;
  return {
    id: row.id,
    engagementId: row.engagementId,
    submissionId: row.submissionId ?? null,
    subject: row.subject ?? "",
    body: row.body ?? "",
    cta: row.cta ?? "reply",
    language: row.language ?? "en",
    status: row.status,
    usedEntryIds: (row.usedEntryIds as string[]) ?? [],
    lint: (row.lint as Record<string, unknown> | null) ?? null,
    source: row.source ?? "agent",
    receiptId: row.receiptId ?? null,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
};
const asScorecard = (
  raw: typeof paScorecards.$inferSelect,
): ScorecardRecord => {
  const row = decodeJson("scorecards", raw) as any;
  return {
    ...row,
    reasonCodes: row.reasonCodes as unknown[],
    answers: row.answers as unknown[],
    hypothesis: row.hypothesis as Record<string, unknown> | null,
  };
};
const asRelease = (
  raw: typeof paPlaybookReleases.$inferSelect,
): ReleaseRecord => {
  const row = decodeJson("releases", raw) as any;
  return {
    ...row,
    entries: row.entries as unknown[],
    content: row.content as Record<string, unknown>,
  };
};
const asProfile = (
  raw: typeof paUserProfiles.$inferSelect,
): UserProfileRecord => {
  const row = decodeJson("profiles", raw) as any;
  return {
    ...row,
    workingHours: row.workingHours as UserProfileRecord["workingHours"],
    roles: row.roles as string[],
  };
};

const openContactIdFor = (state: string, contactId: string) =>
  OPEN_STATES.has(state as EngagementState) ? contactId : null;

function withoutId<T extends { id: string }>(patch: Partial<T>): Partial<T> {
  const { id: _ignored, ...rest } = patch as T;
  return rest as Partial<T>;
}

export class DrizzleRepository implements PaRepository {
  constructor(private readonly db: Executor = getDb()) {}

  async transaction<T>(work: (repo: PaRepository) => Promise<T>): Promise<T> {
    return (this.db as Db).transaction((tx) => work(new DrizzleRepository(tx)));
  }

  async insertInboxIfAbsent(record: InboxRecord) {
    const inserted = await this.db
      .insert(paInbox)
      .values(encodeJson<any>("inbox", record))
      .onConflictDoNothing({ target: [paInbox.source, paInbox.externalId] })
      .returning();
    if (inserted[0]) return { record: asInbox(inserted[0]), inserted: true };
    const existing = await this.getInboxBySource(
      record.source,
      record.externalId,
    );
    if (!existing)
      throw new Error("Inbox insert conflicted but no row was found");
    return { record: existing, inserted: false };
  }
  async getInbox(id: string) {
    const [row] = await this.db
      .select()
      .from(paInbox)
      .where(eq(paInbox.id, id));
    return row ? asInbox(row) : null;
  }
  async getInboxBySource(source: string, externalId: string) {
    const [row] = await this.db
      .select()
      .from(paInbox)
      .where(
        and(eq(paInbox.source, source), eq(paInbox.externalId, externalId)),
      );
    return row ? asInbox(row) : null;
  }
  async listInboxBySource(
    source: string,
    statuses: InboxRecord["status"][],
    limit: number,
  ) {
    const rows = await this.db
      .select()
      .from(paInbox)
      .where(and(eq(paInbox.source, source), inArray(paInbox.status, statuses)))
      .orderBy(asc(paInbox.receivedAt), asc(paInbox.id))
      .limit(limit);
    return rows.map(asInbox);
  }
  async updateInbox(
    id: string,
    patch: Partial<InboxRecord>,
    expectedVersion: number,
  ) {
    const [row] = await this.db
      .update(paInbox)
      .set(
        encodeJson<any>("inbox", {
          ...withoutId(patch),
          version: expectedVersion + 1,
        }),
      )
      .where(and(eq(paInbox.id, id), eq(paInbox.version, expectedVersion)))
      .returning();
    if (!row)
      throw new VersionConflictError(
        `Inbox row ${id} changed underneath this update`,
      );
    return asInbox(row);
  }

  async insertSubmission(record: SubmissionRecord) {
    await this.db
      .insert(paSubmissions)
      .values(encodeJson<any>("submissions", record));
  }
  async getSubmission(id: string) {
    const [row] = await this.db
      .select()
      .from(paSubmissions)
      .where(eq(paSubmissions.id, id));
    return row ? asSubmission(row) : null;
  }
  async getSubmissionByInbox(inboxId: string) {
    const [row] = await this.db
      .select()
      .from(paSubmissions)
      .where(eq(paSubmissions.inboxId, inboxId));
    return row ? asSubmission(row) : null;
  }
  async listSubmissionsForEngagement(engagementId: string) {
    const rows = await this.db
      .select()
      .from(paSubmissions)
      .where(eq(paSubmissions.engagementId, engagementId))
      .orderBy(asc(paSubmissions.submittedAt));
    return rows.map(asSubmission);
  }
  async setSubmissionEngagement(
    id: string,
    engagementId: string,
    updatedAt: string,
  ) {
    await this.db
      .update(paSubmissions)
      .set({ engagementId, updatedAt })
      .where(eq(paSubmissions.id, id));
  }

  async getAccountByDomain(domain: string) {
    const [row] = await this.db
      .select()
      .from(paAccounts)
      .where(eq(paAccounts.domain, domain));
    return row ? asAccount(row) : null;
  }
  async getAccount(id: string) {
    const [row] = await this.db
      .select()
      .from(paAccounts)
      .where(eq(paAccounts.id, id));
    return row ? asAccount(row) : null;
  }
  async insertAccount(record: AccountRecord) {
    await this.db
      .insert(paAccounts)
      .values(encodeJson<any>("accounts", record));
  }

  async getContactByEmail(email: string) {
    const [row] = await this.db
      .select()
      .from(paContacts)
      .where(eq(paContacts.email, email));
    return row ?? null;
  }
  async getContact(id: string) {
    const [row] = await this.db
      .select()
      .from(paContacts)
      .where(eq(paContacts.id, id));
    return row ?? null;
  }
  async insertContact(record: ContactRecord) {
    await this.db.insert(paContacts).values(record);
  }
  async updateContact(
    id: string,
    patch: Partial<ContactRecord>,
    expectedVersion: number,
  ) {
    const [row] = await this.db
      .update(paContacts)
      .set({ ...withoutId(patch), version: expectedVersion + 1 })
      .where(
        and(eq(paContacts.id, id), eq(paContacts.version, expectedVersion)),
      )
      .returning();
    if (!row)
      throw new VersionConflictError(
        `Contact ${id} changed underneath this update`,
      );
    return row;
  }

  async getEngagement(id: string) {
    const [row] = await this.db
      .select()
      .from(paEngagements)
      .where(eq(paEngagements.id, id));
    return row ? asEngagement(row) : null;
  }
  async listEngagements() {
    const rows = await this.db
      .select()
      .from(paEngagements)
      .orderBy(desc(paEngagements.createdAt))
      .limit(500);
    return rows.map(asEngagement);
  }
  async listEngagementsForContact(contactId: string) {
    const rows = await this.db
      .select()
      .from(paEngagements)
      .where(eq(paEngagements.contactId, contactId));
    return rows.map(asEngagement);
  }
  async insertEngagement(record: EngagementRecord) {
    await this.db.insert(paEngagements).values({
      ...encodeJson<any>("engagements", record),
      openContactId: openContactIdFor(record.state, record.contactId),
    });
  }
  async updateEngagement(
    id: string,
    patch: Partial<EngagementRecord>,
    expectedVersion: number,
  ) {
    const [row] = await this.db
      .update(paEngagements)
      .set({
        ...encodeJson<any>("engagements", {
          ...withoutId(patch),
          version: expectedVersion + 1,
        }),
        ...(patch.state === undefined
          ? {}
          : {
              openContactId: OPEN_STATES.has(patch.state as EngagementState)
                ? sql`${paEngagements.contactId}`
                : null,
            }),
      })
      .where(
        and(
          eq(paEngagements.id, id),
          eq(paEngagements.version, expectedVersion),
        ),
      )
      .returning();
    if (!row)
      throw new VersionConflictError(
        `Engagement ${id} changed underneath this update`,
      );
    return asEngagement(row);
  }

  async appendEvent(record: EventRecord) {
    await this.db.insert(paEvents).values(encodeJson<any>("events", record));
  }
  async listEvents(engagementId: string) {
    const rows = await this.db
      .select()
      .from(paEvents)
      .where(eq(paEvents.engagementId, engagementId))
      .orderBy(asc(paEvents.occurredAt), asc(paEvents.id));
    return rows.map(asEvent);
  }
  async listEventsByCorrelation(correlationId: string) {
    const rows = await this.db
      .select()
      .from(paEvents)
      .where(eq(paEvents.correlationId, correlationId))
      .orderBy(asc(paEvents.occurredAt), asc(paEvents.id));
    return rows.map(asEvent);
  }

  async insertReceipt(record: ReceiptRecord) {
    await this.db
      .insert(paReceipts)
      .values(encodeJson<any>("receipts", record));
  }
  async getReceipt(id: string) {
    const [row] = await this.db
      .select()
      .from(paReceipts)
      .where(eq(paReceipts.id, id));
    return row ? asReceipt(row) : null;
  }
  async findReceipt(kind: string, submissionId: string) {
    const [row] = await this.db
      .select()
      .from(paReceipts)
      .where(
        and(
          eq(paReceipts.kind, kind),
          eq(paReceipts.submissionId, submissionId),
        ),
      )
      .orderBy(desc(paReceipts.createdAt))
      .limit(1);
    return row ? asReceipt(row) : null;
  }
  async listReceipts(engagementId: string) {
    const rows = await this.db
      .select()
      .from(paReceipts)
      .where(eq(paReceipts.engagementId, engagementId))
      .orderBy(asc(paReceipts.createdAt), asc(paReceipts.id));
    return rows.map(asReceipt);
  }

  async insertAssessment(record: AssessmentRecord) {
    await this.db
      .insert(paAssessments)
      .values(encodeJson<any>("assessments", record));
  }
  async getAssessmentForSubmission(submissionId: string) {
    const [row] = await this.db
      .select()
      .from(paAssessments)
      .where(eq(paAssessments.submissionId, submissionId))
      .orderBy(desc(paAssessments.createdAt), desc(paAssessments.id))
      .limit(1);
    return row ? asAssessment(row) : null;
  }
  async listAssessments(engagementId: string) {
    const rows = await this.db
      .select()
      .from(paAssessments)
      .where(eq(paAssessments.engagementId, engagementId))
      .orderBy(asc(paAssessments.createdAt), asc(paAssessments.id));
    return rows.map(asAssessment);
  }

  async listHandbookDocs() {
    const rows = await this.db
      .select()
      .from(paHandbookDocs)
      .orderBy(asc(paHandbookDocs.position), asc(paHandbookDocs.id));
    return rows as HandbookDocRecord[];
  }
  async getHandbookDoc(id: string) {
    const [row] = await this.db
      .select()
      .from(paHandbookDocs)
      .where(eq(paHandbookDocs.id, id))
      .limit(1);
    return (row as HandbookDocRecord | undefined) ?? null;
  }
  async insertHandbookDoc(record: HandbookDocRecord) {
    await this.db.insert(paHandbookDocs).values(record);
  }
  async updateHandbookDoc(
    id: string,
    patch: Partial<HandbookDocRecord>,
    expectedVersion: number,
  ) {
    const { id: _id, version: _version, ...rest } = patch;
    const [row] = await this.db
      .update(paHandbookDocs)
      .set({ ...rest, version: expectedVersion + 1 })
      .where(
        and(
          eq(paHandbookDocs.id, id),
          eq(paHandbookDocs.version, expectedVersion),
        ),
      )
      .returning();
    if (!row)
      throw new VersionConflictError(
        `Handbook doc ${id} changed underneath this update`,
      );
    return row as HandbookDocRecord;
  }
  async insertHandbookRevision(record: HandbookRevisionRecord) {
    await this.db.insert(paHandbookRevisions).values(record);
  }
  async listHandbookRevisions(docId: string) {
    const rows = await this.db
      .select()
      .from(paHandbookRevisions)
      .where(eq(paHandbookRevisions.docId, docId))
      .orderBy(desc(paHandbookRevisions.version));
    return rows as HandbookRevisionRecord[];
  }

  async insertDecisionIfAbsent(record: DecisionRecord) {
    const rows = await this.db
      .insert(paDecisions)
      .values(encodeJson<any>("decisions", record))
      .onConflictDoNothing({ target: paDecisions.engagementId })
      .returning({ id: paDecisions.id });
    return rows.length > 0;
  }
  async getDecision(engagementId: string) {
    const [row] = await this.db
      .select()
      .from(paDecisions)
      .where(eq(paDecisions.engagementId, engagementId))
      .limit(1);
    return row
      ? (decodeJson("decisions", row) as unknown as DecisionRecord)
      : null;
  }
  async listOpenDecisions() {
    const rows = await this.db
      .select()
      .from(paDecisions)
      .where(eq(paDecisions.status, "open"))
      .orderBy(asc(paDecisions.dueAt));
    return rows.map(
      (row) => decodeJson("decisions", row) as unknown as DecisionRecord,
    );
  }
  async updateDecision(
    id: string,
    patch: Partial<DecisionRecord>,
    expectedVersion: number,
  ) {
    const { id: _id, version: _version, ...rest } = patch;
    const [row] = await this.db
      .update(paDecisions)
      .set({
        ...encodeJson<any>("decisions", rest),
        version: expectedVersion + 1,
      })
      .where(
        and(eq(paDecisions.id, id), eq(paDecisions.version, expectedVersion)),
      )
      .returning();
    if (!row)
      throw new VersionConflictError(
        `Decision ${id} changed underneath this update`,
      );
    return decodeJson("decisions", row) as unknown as DecisionRecord;
  }

  async insertDraft(record: DraftRecord) {
    await this.db
      .insert(paDrafts)
      .values(encodeJson<any>("drafts", { ...record, editReasons: [] }));
  }
  async listDrafts(engagementId: string) {
    const rows = await this.db
      .select()
      .from(paDrafts)
      .where(eq(paDrafts.engagementId, engagementId))
      .orderBy(asc(paDrafts.createdAt), asc(paDrafts.id));
    return rows.map(asDraft);
  }

  async insertScorecard(record: ScorecardRecord) {
    await this.db
      .insert(paScorecards)
      .values(encodeJson<any>("scorecards", record));
  }
  async listScorecards(engagementId: string) {
    const rows = await this.db
      .select()
      .from(paScorecards)
      .where(eq(paScorecards.engagementId, engagementId))
      .orderBy(asc(paScorecards.version));
    return rows.map(asScorecard);
  }

  async insertReleaseIfAbsent(record: ReleaseRecord) {
    const inserted = await this.db
      .insert(paPlaybookReleases)
      .values(encodeJson<any>("releases", record))
      .onConflictDoNothing({ target: paPlaybookReleases.id })
      .returning({ id: paPlaybookReleases.id });
    return inserted.length > 0;
  }
  async getRelease(id: string) {
    const [row] = await this.db
      .select()
      .from(paPlaybookReleases)
      .where(eq(paPlaybookReleases.id, id));
    return row ? asRelease(row) : null;
  }
  async latestReleaseWithLabel(label: string) {
    const [row] = await this.db
      .select()
      .from(paPlaybookReleases)
      .where(eq(paPlaybookReleases.label, label))
      .orderBy(desc(paPlaybookReleases.createdAt))
      .limit(1);
    return row ? asRelease(row) : null;
  }

  async upsertProfile(record: UserProfileRecord) {
    const {
      id: _id,
      createdAt: _createdAt,
      version: _version,
      ...updatable
    } = record;
    const [row] = await this.db
      .insert(paUserProfiles)
      .values(encodeJson<any>("profiles", record))
      .onConflictDoUpdate({
        target: paUserProfiles.email,
        set: {
          ...encodeJson<any>("profiles", updatable),
          version: sql`${paUserProfiles.version} + 1`,
        },
      })
      .returning();
    return asProfile(row);
  }
  async listProfiles() {
    const rows = await this.db
      .select()
      .from(paUserProfiles)
      .orderBy(asc(paUserProfiles.displayName));
    return rows.map(asProfile);
  }
  async getProfile(id: string) {
    const [row] = await this.db
      .select()
      .from(paUserProfiles)
      .where(eq(paUserProfiles.id, id));
    return row ? asProfile(row) : null;
  }
  async getProfileByUserId(userId: string) {
    const [row] = await this.db
      .select()
      .from(paUserProfiles)
      .where(eq(paUserProfiles.userId, userId));
    return row ? asProfile(row) : null;
  }

  async listReleases(limit: number) {
    const rows = await this.db
      .select()
      .from(paPlaybookReleases)
      .orderBy(desc(paPlaybookReleases.createdAt))
      .limit(limit);
    return rows.map(asRelease);
  }
  async getLabel(label: string) {
    const [row] = await this.db
      .select()
      .from(paReleaseLabels)
      .where(eq(paReleaseLabels.label, label));
    return (row as ReleaseLabelRecord | undefined) ?? null;
  }
  async createLabelIfAbsent(record: ReleaseLabelRecord) {
    await this.db
      .insert(paReleaseLabels)
      .values(record)
      .onConflictDoNothing({ target: paReleaseLabels.label });
    const stored = await this.getLabel(record.label);
    if (!stored) throw new Error(`Label ${record.label} could not be created`);
    return stored;
  }
  async moveLabel(
    label: string,
    patch: { releaseId: string; movedBy: string; movedAt: string },
    expectedVersion: number,
  ) {
    const [row] = await this.db
      .update(paReleaseLabels)
      .set({ ...patch, version: expectedVersion + 1 })
      .where(
        and(
          eq(paReleaseLabels.label, label),
          eq(paReleaseLabels.version, expectedVersion),
        ),
      )
      .returning();
    if (!row)
      throw new VersionConflictError(
        `Release label ${label} moved underneath this update`,
      );
    return row as ReleaseLabelRecord;
  }

  async insertChange(record: ChangeRecord) {
    await this.db
      .insert(paPlaybookChanges)
      .values(encodeJson<any>("playbookChanges", record));
  }
  async getChange(id: string) {
    const [row] = await this.db
      .select()
      .from(paPlaybookChanges)
      .where(eq(paPlaybookChanges.id, id));
    return row
      ? (decodeJson("playbookChanges", row) as unknown as ChangeRecord)
      : null;
  }
  async listChanges(filter: { statuses?: ChangeStatus[]; limit: number }) {
    const rows = await this.db
      .select()
      .from(paPlaybookChanges)
      .where(
        filter.statuses
          ? inArray(paPlaybookChanges.status, filter.statuses)
          : undefined,
      )
      .orderBy(desc(paPlaybookChanges.updatedAt))
      .limit(filter.limit);
    return rows.map(
      (row) => decodeJson("playbookChanges", row) as unknown as ChangeRecord,
    );
  }
  async updateChange(
    id: string,
    patch: Partial<ChangeRecord>,
    expectedVersion: number,
  ) {
    const [row] = await this.db
      .update(paPlaybookChanges)
      .set(
        encodeJson<any>("playbookChanges", {
          ...withoutId(patch),
          version: expectedVersion + 1,
        }),
      )
      .where(
        and(
          eq(paPlaybookChanges.id, id),
          eq(paPlaybookChanges.version, expectedVersion),
        ),
      )
      .returning();
    if (!row)
      throw new VersionConflictError(
        `Playbook change ${id} changed underneath this update`,
      );
    return decodeJson("playbookChanges", row) as unknown as ChangeRecord;
  }

  async upsertChangeItem(record: ChangeItemRecord) {
    const {
      id: _id,
      createdAt: _createdAt,
      changeId: _changeId,
      target: _target,
      ...updatable
    } = record;
    const [row] = await this.db
      .insert(paPlaybookChangeItems)
      .values(encodeJson<any>("playbookChangeItems", record))
      .onConflictDoUpdate({
        target: [paPlaybookChangeItems.changeId, paPlaybookChangeItems.target],
        set: encodeJson<any>("playbookChangeItems", updatable),
      })
      .returning();
    return decodeJson(
      "playbookChangeItems",
      row,
    ) as unknown as ChangeItemRecord;
  }
  async deleteChangeItem(changeId: string, target: string) {
    await this.db
      .delete(paPlaybookChangeItems)
      .where(
        and(
          eq(paPlaybookChangeItems.changeId, changeId),
          eq(paPlaybookChangeItems.target, target),
        ),
      );
  }
  async listChangeItems(changeId: string) {
    const rows = await this.db
      .select()
      .from(paPlaybookChangeItems)
      .where(eq(paPlaybookChangeItems.changeId, changeId))
      .orderBy(asc(paPlaybookChangeItems.target));
    return rows.map(
      (row) =>
        decodeJson("playbookChangeItems", row) as unknown as ChangeItemRecord,
    );
  }

  async insertApproval(record: ApprovalRecord) {
    await this.db.insert(paPlaybookApprovals).values(record);
  }
  async listApprovals(changeId: string) {
    const rows = await this.db
      .select()
      .from(paPlaybookApprovals)
      .where(eq(paPlaybookApprovals.changeId, changeId))
      .orderBy(asc(paPlaybookApprovals.createdAt));
    return rows as ApprovalRecord[];
  }

  async recordSuggestion(record: SuggestionRecord) {
    const inserted = await this.db
      .insert(paSuggestions)
      .values(encodeJson<any>("suggestions", record))
      .onConflictDoNothing({ target: paSuggestions.dedupeKey })
      .returning();
    if (inserted[0])
      return {
        record: decodeJson(
          "suggestions",
          inserted[0],
        ) as unknown as SuggestionRecord,
        inserted: true,
      };
    const [existing] = await this.db
      .select()
      .from(paSuggestions)
      .where(eq(paSuggestions.dedupeKey, record.dedupeKey));
    if (!existing)
      throw new Error("Suggestion insert conflicted but no row was found");
    return {
      record: decodeJson(
        "suggestions",
        existing,
      ) as unknown as SuggestionRecord,
      inserted: false,
    };
  }
  async getSuggestion(id: string) {
    const [row] = await this.db
      .select()
      .from(paSuggestions)
      .where(eq(paSuggestions.id, id));
    return row
      ? (decodeJson("suggestions", row) as unknown as SuggestionRecord)
      : null;
  }
  async listSuggestions(filter: {
    audiences?: SuggestionAudience[];
    statuses?: SuggestionStatus[];
    limit: number;
  }) {
    const rows = await this.db
      .select()
      .from(paSuggestions)
      .where(
        and(
          filter.audiences
            ? inArray(paSuggestions.audience, filter.audiences)
            : undefined,
          filter.statuses
            ? inArray(paSuggestions.status, filter.statuses)
            : undefined,
        ),
      )
      .orderBy(desc(paSuggestions.createdAt))
      .limit(filter.limit);
    return rows.map(
      (row) => decodeJson("suggestions", row) as unknown as SuggestionRecord,
    );
  }
  async updateSuggestion(
    id: string,
    patch: Partial<SuggestionRecord>,
    expectedVersion: number,
  ) {
    const [row] = await this.db
      .update(paSuggestions)
      .set(
        encodeJson<any>("suggestions", {
          ...withoutId(patch),
          version: expectedVersion + 1,
        }),
      )
      .where(
        and(
          eq(paSuggestions.id, id),
          eq(paSuggestions.version, expectedVersion),
        ),
      )
      .returning();
    if (!row)
      throw new VersionConflictError(
        `Suggestion ${id} changed underneath this update`,
      );
    return decodeJson("suggestions", row) as unknown as SuggestionRecord;
  }
}

export function paRepository(): PaRepository {
  return new DrizzleRepository();
}
