import {
  VersionConflictError,
  type AccountRecord,
  type AssessmentRecord,
  type DraftRecord,
  type HandbookDocRecord,
  type HandbookRevisionRecord,
  type ContactRecord,
  type EngagementRecord,
  type EventRecord,
  type InboxRecord,
  type PaRepository,
  type ReceiptRecord,
  type ReleaseRecord,
  type ScorecardRecord,
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
} from "./types.js";

interface Tables {
  inbox: Map<string, InboxRecord>;
  submissions: Map<string, SubmissionRecord>;
  accounts: Map<string, AccountRecord>;
  contacts: Map<string, ContactRecord>;
  engagements: Map<string, EngagementRecord>;
  events: EventRecord[];
  receipts: Map<string, ReceiptRecord>;
  assessments: Map<string, AssessmentRecord>;
  scorecards: Map<string, ScorecardRecord>;
  drafts: Map<string, DraftRecord>;
  handbook: Map<string, HandbookDocRecord>;
  handbookRevisions: Map<string, HandbookRevisionRecord>;
  releases: Map<string, ReleaseRecord>;
  profiles: Map<string, UserProfileRecord>;
  labels: Map<string, ReleaseLabelRecord>;
  changes: Map<string, ChangeRecord>;
  changeItems: Map<string, ChangeItemRecord>;
  approvals: ApprovalRecord[];
  suggestions: Map<string, SuggestionRecord>;
}

function emptyTables(): Tables {
  return {
    inbox: new Map(),
    submissions: new Map(),
    accounts: new Map(),
    contacts: new Map(),
    engagements: new Map(),
    events: [],
    receipts: new Map(),
    assessments: new Map(),
    scorecards: new Map(),
    drafts: new Map(),
    handbook: new Map(),
    handbookRevisions: new Map(),
    releases: new Map(),
    profiles: new Map(),
    labels: new Map(),
    changes: new Map(),
    changeItems: new Map(),
    approvals: [],
    suggestions: new Map(),
  };
}

function cloneTables(tables: Tables): Tables {
  return structuredClone(tables);
}

const copy = <T>(value: T): T => structuredClone(value);

function bumpVersioned<T extends { version: number }>(
  table: Map<string, T>,
  id: string,
  patch: Partial<T>,
  expectedVersion: number,
  label: string,
): T {
  const current = table.get(id);
  if (!current) throw new Error(`${label} ${id} not found`);
  if (current.version !== expectedVersion) {
    throw new VersionConflictError(
      `${label} ${id} is at version ${current.version}, expected ${expectedVersion}`,
    );
  }
  const next = { ...current, ...patch, version: current.version + 1 };
  table.set(id, next);
  return copy(next);
}

export class MemoryRepository implements PaRepository {
  private tables: Tables = emptyTables();

  async transaction<T>(work: (repo: PaRepository) => Promise<T>): Promise<T> {
    const snapshot = cloneTables(this.tables);
    try {
      return await work(this);
    } catch (error) {
      this.tables = snapshot;
      throw error;
    }
  }

  counts() {
    return {
      inbox: this.tables.inbox.size,
      submissions: this.tables.submissions.size,
      engagements: this.tables.engagements.size,
      events: this.tables.events.length,
      receipts: this.tables.receipts.size,
      assessments: this.tables.assessments.size,
      scorecards: this.tables.scorecards.size,
      drafts: this.tables.drafts.size,
    };
  }

  async insertInboxIfAbsent(record: InboxRecord) {
    for (const existing of this.tables.inbox.values()) {
      if (
        existing.source === record.source &&
        existing.externalId === record.externalId
      ) {
        return { record: copy(existing), inserted: false };
      }
    }
    this.tables.inbox.set(record.id, copy(record));
    return { record: copy(record), inserted: true };
  }
  async getInbox(id: string) {
    const found = this.tables.inbox.get(id);
    return found ? copy(found) : null;
  }
  async getInboxBySource(source: string, externalId: string) {
    for (const existing of this.tables.inbox.values()) {
      if (existing.source === source && existing.externalId === externalId)
        return copy(existing);
    }
    return null;
  }
  async listInboxBySource(
    source: string,
    statuses: InboxRecord["status"][],
    limit: number,
  ) {
    return [...this.tables.inbox.values()]
      .filter(
        (item) => item.source === source && statuses.includes(item.status),
      )
      .sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))
      .slice(0, limit)
      .map(copy);
  }
  async updateInbox(
    id: string,
    patch: Partial<InboxRecord>,
    expectedVersion: number,
  ) {
    return bumpVersioned(
      this.tables.inbox,
      id,
      patch,
      expectedVersion,
      "Inbox row",
    );
  }

  async insertSubmission(record: SubmissionRecord) {
    for (const existing of this.tables.submissions.values()) {
      if (existing.inboxId === record.inboxId)
        throw new Error("Duplicate submission for inbox row");
    }
    this.tables.submissions.set(record.id, copy(record));
  }
  async getSubmission(id: string) {
    const found = this.tables.submissions.get(id);
    return found ? copy(found) : null;
  }
  async getSubmissionByInbox(inboxId: string) {
    for (const existing of this.tables.submissions.values()) {
      if (existing.inboxId === inboxId) return copy(existing);
    }
    return null;
  }
  async listSubmissionsForEngagement(engagementId: string) {
    return [...this.tables.submissions.values()]
      .filter((item) => item.engagementId === engagementId)
      .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
      .map(copy);
  }
  async setSubmissionEngagement(
    id: string,
    engagementId: string,
    updatedAt: string,
  ) {
    const found = this.tables.submissions.get(id);
    if (!found) throw new Error(`Submission ${id} not found`);
    this.tables.submissions.set(id, { ...found, engagementId, updatedAt });
  }

  async getAccountByDomain(domain: string) {
    for (const existing of this.tables.accounts.values()) {
      if (existing.domain === domain) return copy(existing);
    }
    return null;
  }
  async getAccount(id: string) {
    const found = this.tables.accounts.get(id);
    return found ? copy(found) : null;
  }
  async insertAccount(record: AccountRecord) {
    this.tables.accounts.set(record.id, copy(record));
  }

  async getContactByEmail(email: string) {
    for (const existing of this.tables.contacts.values()) {
      if (existing.email === email) return copy(existing);
    }
    return null;
  }
  async getContact(id: string) {
    const found = this.tables.contacts.get(id);
    return found ? copy(found) : null;
  }
  async insertContact(record: ContactRecord) {
    this.tables.contacts.set(record.id, copy(record));
  }
  async updateContact(
    id: string,
    patch: Partial<ContactRecord>,
    expectedVersion: number,
  ) {
    return bumpVersioned(
      this.tables.contacts,
      id,
      patch,
      expectedVersion,
      "Contact",
    );
  }

  async getEngagement(id: string) {
    const found = this.tables.engagements.get(id);
    return found ? copy(found) : null;
  }
  async listEngagements() {
    return [...this.tables.engagements.values()].map(copy);
  }
  async listEngagementsForContact(contactId: string) {
    return [...this.tables.engagements.values()]
      .filter((item) => item.contactId === contactId)
      .map(copy);
  }
  async insertEngagement(record: EngagementRecord) {
    this.tables.engagements.set(record.id, copy(record));
  }
  async updateEngagement(
    id: string,
    patch: Partial<EngagementRecord>,
    expectedVersion: number,
  ) {
    return bumpVersioned(
      this.tables.engagements,
      id,
      patch,
      expectedVersion,
      "Engagement",
    );
  }

  async appendEvent(record: EventRecord) {
    this.tables.events.push(copy(record));
  }
  async listEvents(engagementId: string) {
    return this.tables.events
      .filter((item) => item.engagementId === engagementId)
      .sort(
        (a, b) =>
          a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id),
      )
      .map(copy);
  }
  async listEventsByCorrelation(correlationId: string) {
    return this.tables.events
      .filter((item) => item.correlationId === correlationId)
      .map(copy);
  }

  async insertReceipt(record: ReceiptRecord) {
    this.tables.receipts.set(record.id, copy(record));
  }
  async getReceipt(id: string) {
    const found = this.tables.receipts.get(id);
    return found ? copy(found) : null;
  }
  async findReceipt(kind: string, submissionId: string) {
    for (const existing of this.tables.receipts.values()) {
      if (existing.kind === kind && existing.submissionId === submissionId)
        return copy(existing);
    }
    return null;
  }
  async listReceipts(engagementId: string) {
    return [...this.tables.receipts.values()]
      .filter((item) => item.engagementId === engagementId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      .map(copy);
  }

  async insertAssessment(record: AssessmentRecord) {
    this.tables.assessments.set(record.id, copy(record));
  }
  async getAssessmentForSubmission(submissionId: string) {
    const matches = [...this.tables.assessments.values()]
      .filter((item) => item.submissionId === submissionId)
      .sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
      );
    return matches[0] ? copy(matches[0]) : null;
  }
  async listAssessments(engagementId: string) {
    return [...this.tables.assessments.values()]
      .filter((item) => item.engagementId === engagementId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      .map(copy);
  }

  async listHandbookDocs() {
    return [...this.tables.handbook.values()]
      .sort((a, b) => a.position - b.position || a.id.localeCompare(b.id))
      .map(copy);
  }
  async getHandbookDoc(id: string) {
    const found = this.tables.handbook.get(id);
    return found ? copy(found) : null;
  }
  async insertHandbookDoc(record: HandbookDocRecord) {
    if (this.tables.handbook.has(record.id))
      throw new Error(`Handbook doc ${record.id} already exists`);
    this.tables.handbook.set(record.id, copy(record));
  }
  async updateHandbookDoc(
    id: string,
    patch: Partial<HandbookDocRecord>,
    expectedVersion: number,
  ) {
    return copy(
      bumpVersioned(
        this.tables.handbook,
        id,
        patch,
        expectedVersion,
        "Handbook doc",
      ),
    );
  }
  async insertHandbookRevision(record: HandbookRevisionRecord) {
    for (const existing of this.tables.handbookRevisions.values()) {
      if (
        existing.docId === record.docId &&
        existing.version === record.version
      )
        throw new Error("Handbook revision already exists");
    }
    this.tables.handbookRevisions.set(record.id, copy(record));
  }
  async listHandbookRevisions(docId: string) {
    return [...this.tables.handbookRevisions.values()]
      .filter((item) => item.docId === docId)
      .sort((a, b) => b.version - a.version)
      .map(copy);
  }

  async insertDraft(record: DraftRecord) {
    this.tables.drafts.set(record.id, copy(record));
  }
  async listDrafts(engagementId: string) {
    return [...this.tables.drafts.values()]
      .filter((item) => item.engagementId === engagementId)
      .sort(
        (a, b) =>
          a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id),
      )
      .map(copy);
  }

  async insertScorecard(record: ScorecardRecord) {
    for (const existing of this.tables.scorecards.values()) {
      if (
        existing.engagementId === record.engagementId &&
        existing.version === record.version
      ) {
        throw new Error("Scorecard version already exists");
      }
    }
    this.tables.scorecards.set(record.id, copy(record));
  }
  async listScorecards(engagementId: string) {
    return [...this.tables.scorecards.values()]
      .filter((item) => item.engagementId === engagementId)
      .sort((a, b) => a.version - b.version)
      .map(copy);
  }

  async insertReleaseIfAbsent(record: ReleaseRecord) {
    if (this.tables.releases.has(record.id)) return false;
    this.tables.releases.set(record.id, copy(record));
    return true;
  }
  async getRelease(id: string) {
    const found = this.tables.releases.get(id);
    return found ? copy(found) : null;
  }
  async latestReleaseWithLabel(label: string) {
    const matches = [...this.tables.releases.values()]
      .filter((item) => item.label === label)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return matches[0] ? copy(matches[0]) : null;
  }

  async upsertProfile(record: UserProfileRecord) {
    for (const [id, existing] of this.tables.profiles) {
      if (existing.email === record.email) {
        const next = {
          ...existing,
          ...record,
          id,
          createdAt: existing.createdAt,
          version: existing.version + 1,
        };
        this.tables.profiles.set(id, next);
        return copy(next);
      }
    }
    this.tables.profiles.set(record.id, copy(record));
    return copy(record);
  }
  async listProfiles() {
    return [...this.tables.profiles.values()].map(copy);
  }
  async getProfile(id: string) {
    const found = this.tables.profiles.get(id);
    return found ? copy(found) : null;
  }
  async getProfileByUserId(userId: string) {
    for (const existing of this.tables.profiles.values()) {
      if (existing.userId === userId) return copy(existing);
    }
    return null;
  }

  async listReleases(limit: number) {
    return [...this.tables.releases.values()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(copy);
  }
  async getLabel(label: string) {
    const found = this.tables.labels.get(label);
    return found ? copy(found) : null;
  }
  async createLabelIfAbsent(record: ReleaseLabelRecord) {
    const existing = this.tables.labels.get(record.label);
    if (existing) return copy(existing);
    this.tables.labels.set(record.label, copy(record));
    return copy(record);
  }
  async moveLabel(
    label: string,
    patch: { releaseId: string; movedBy: string; movedAt: string },
    expectedVersion: number,
  ) {
    return bumpVersioned(
      this.tables.labels,
      label,
      patch,
      expectedVersion,
      "Release label",
    );
  }

  async insertChange(record: ChangeRecord) {
    this.tables.changes.set(record.id, copy(record));
  }
  async getChange(id: string) {
    const found = this.tables.changes.get(id);
    return found ? copy(found) : null;
  }
  async listChanges(filter: { statuses?: ChangeStatus[]; limit: number }) {
    return [...this.tables.changes.values()]
      .filter(
        (item) => !filter.statuses || filter.statuses.includes(item.status),
      )
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, filter.limit)
      .map(copy);
  }
  async updateChange(
    id: string,
    patch: Partial<ChangeRecord>,
    expectedVersion: number,
  ) {
    return bumpVersioned(
      this.tables.changes,
      id,
      patch,
      expectedVersion,
      "Playbook change",
    );
  }

  async upsertChangeItem(record: ChangeItemRecord) {
    for (const [id, existing] of this.tables.changeItems) {
      if (
        existing.changeId === record.changeId &&
        existing.target === record.target
      ) {
        const next = { ...record, id, createdAt: existing.createdAt };
        this.tables.changeItems.set(id, next);
        return copy(next);
      }
    }
    this.tables.changeItems.set(record.id, copy(record));
    return copy(record);
  }
  async deleteChangeItem(changeId: string, target: string) {
    for (const [id, existing] of this.tables.changeItems) {
      if (existing.changeId === changeId && existing.target === target)
        this.tables.changeItems.delete(id);
    }
  }
  async listChangeItems(changeId: string) {
    return [...this.tables.changeItems.values()]
      .filter((item) => item.changeId === changeId)
      .sort((a, b) => a.target.localeCompare(b.target))
      .map(copy);
  }

  async insertApproval(record: ApprovalRecord) {
    const duplicate = this.tables.approvals.some(
      (item) =>
        item.changeId === record.changeId &&
        item.team === record.team &&
        item.reviewerEmail === record.reviewerEmail,
    );
    if (duplicate)
      throw new Error("Duplicate approval for this change, team, and reviewer");
    this.tables.approvals.push(copy(record));
  }
  async listApprovals(changeId: string) {
    return this.tables.approvals
      .filter((item) => item.changeId === changeId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(copy);
  }

  async recordSuggestion(record: SuggestionRecord) {
    for (const existing of this.tables.suggestions.values()) {
      if (existing.dedupeKey === record.dedupeKey)
        return { record: copy(existing), inserted: false };
    }
    this.tables.suggestions.set(record.id, copy(record));
    return { record: copy(record), inserted: true };
  }
  async getSuggestion(id: string) {
    const found = this.tables.suggestions.get(id);
    return found ? copy(found) : null;
  }
  async listSuggestions(filter: {
    audiences?: SuggestionAudience[];
    statuses?: SuggestionStatus[];
    limit: number;
  }) {
    return [...this.tables.suggestions.values()]
      .filter(
        (item) => !filter.audiences || filter.audiences.includes(item.audience),
      )
      .filter(
        (item) => !filter.statuses || filter.statuses.includes(item.status),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, filter.limit)
      .map(copy);
  }
  async updateSuggestion(
    id: string,
    patch: Partial<SuggestionRecord>,
    expectedVersion: number,
  ) {
    return bumpVersioned(
      this.tables.suggestions,
      id,
      patch,
      expectedVersion,
      "Suggestion",
    );
  }
}
