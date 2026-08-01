import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconChevronRight,
  IconLoader2,
  IconLock,
  IconPlus,
  IconRefresh,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

import { buildOverallScoreBreakdown, ScorePill } from "@/components/ScorePill";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Segments` }];
}

// ── Types ────────────────────────────────────────────────────────────────────

type Visibility = "private" | "public";

interface SegmentListRow {
  id: string;
  name: string;
  ownerEmail: string;
  assignedToEmail: string | null;
  visibility: Visibility;
  personaId: string | null;
  status: string;
  lastRefreshedAt: string | null;
  createdAt: string | null;
  personaName: string | null;
  personaColor: string | null;
  contactCount: number;
}

interface SegmentDetail {
  id: string;
  name: string;
  ownerEmail: string;
  assignedToEmail: string | null;
  visibility: Visibility;
  personaId: string | null;
  status: string;
  lastRefreshedAt: string | null;
  createdAt: string | null;
  owningSourcingRuleId: string | null;
  owningSourcingRuleName: string | null;
}

interface SegmentContact {
  id: string;
  name: string;
  title: string | null;
  company: string | null;
  email: string | null;
  personaMatchScore: number | null;
  companyFitScore: number | null;
  engagementScore: number | null;
  hubspotQlScore: number | null;
  commonRoomIntentScore: number | null;
  commonRoomCompanyFitScore: number | null;
  overallScore: number | null;
  scoreReasoning: string | null;
  status: "active" | "actioned";
  linkedinUrl: string | null;
  hubspotUrl: string | null;
}

interface PersonaOption {
  id: string;
  name: string;
  color: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatRelativeTime(iso: string | null) {
  if (!iso) return "Never refreshed";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "Never refreshed";
  const diffMs = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return "Refreshed just now";
  if (minutes < 60) return `Refreshed ${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `Refreshed ${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `Refreshed ${days}d ago`;
  return `Refreshed ${new Date(iso).toLocaleDateString([], { month: "short", day: "numeric" })}`;
}

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ── Small UI bits ────────────────────────────────────────────────────────────

function VisibilityBadge({ visibility }: { visibility: Visibility }) {
  const isPublic = visibility === "public";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isPublic
          ? "bg-sky-500/10 text-sky-600 dark:text-sky-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {isPublic ? "Public" : "Private"}
    </span>
  );
}

function PersonaBadge({ name, color }: { name: string; color: string | null }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-[11px] font-medium text-foreground">
      <span
        className="size-1.5 shrink-0 rounded-full"
        style={{ background: color ?? "#6366f1" }}
      />
      <span className="truncate">{name}</span>
    </span>
  );
}

// ── Segment card (list view) ─────────────────────────────────────────────────

function SegmentCard({
  segment,
  onOpen,
}: {
  segment: SegmentListRow;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-ring"
      style={segment.personaColor ? { borderTop: `4px solid ${segment.personaColor}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {segment.name}
        </p>
        <IconChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground/40" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <VisibilityBadge visibility={segment.visibility} />
        {segment.personaName && (
          <PersonaBadge name={segment.personaName} color={segment.personaColor} />
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconUsers size={13} />
        {segment.contactCount.toLocaleString()} contact{segment.contactCount === 1 ? "" : "s"}
      </div>

      {segment.assignedToEmail && (
        <p className="truncate text-[11px] text-muted-foreground/70">
          Assigned to {segment.assignedToEmail}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground/50">
        {formatRelativeTime(segment.lastRefreshedAt)}
      </p>
    </button>
  );
}

// ── New segment panel ────────────────────────────────────────────────────────

function NewSegmentPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: personaData, isLoading: personasLoading } = useActionQuery(
    "list-personas",
    {},
  );
  const personas: PersonaOption[] =
    (personaData as { personas?: PersonaOption[] })?.personas ?? [];

  const createSegment = useActionMutation("create-segment");

  const [name, setName] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [minScore, setMinScore] = useState(50);
  const [visibility, setVisibility] = useState<Visibility>("private");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed || !personaId) return;
    try {
      await createSegment.mutateAsync({
        name: trimmed,
        personaId,
        minPersonaMatchScore: minScore,
        visibility,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't create segment."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">New segment</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Q3 outbound — VP Eng"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Persona</label>
            {personasLoading ? (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
                <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading personas…
              </div>
            ) : personas.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No personas yet — create one on the Personas page first.
              </p>
            ) : (
              <select
                value={personaId}
                onChange={(e) => setPersonaId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>
                  Select a persona…
                </option>
                {personas.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Minimum persona match score
            </label>
            <input
              type="number"
              min={0}
              max={100}
              value={minScore}
              onChange={(e) => {
                const v = Number(e.target.value);
                setMinScore(Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : 0);
              }}
              className="w-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Visibility</label>
            <div className="inline-flex rounded-lg border border-border p-0.5">
              {(["private", "public"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setVisibility(v)}
                  className={`rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors ${
                    visibility === v
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            disabled={!name.trim() || !personaId || createSegment.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {createSegment.isPending && <IconLoader2 size={12} className="animate-spin" />}
            Create segment
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Segment detail view ──────────────────────────────────────────────────────

function SegmentDetailView({
  id,
  isAdmin,
  onBack,
  onDeleted,
}: {
  id: string;
  isAdmin: boolean;
  onBack: () => void;
  onDeleted: () => void;
}) {
  const { data, isLoading, error, refetch } = useActionQuery("get-segment", { id });
  const segment: SegmentDetail | undefined = (data as { segment?: SegmentDetail })?.segment;
  const contacts: SegmentContact[] = (data as { contacts?: SegmentContact[] })?.contacts ?? [];
  const loadError = !isLoading && !segment
    ? errorMessage(error, "Couldn't load this segment.")
    : null;

  const updateSegment = useActionMutation("update-segment");
  const assignSegment = useActionMutation("assign-segment");
  const refreshSegment = useActionMutation("refresh-segment");
  const runSourcingRulePipeline = useActionMutation("run-sourcing-rule-pipeline");
  const deleteSegment = useActionMutation("delete-segment");
  const markActioned = useActionMutation("mark-contact-actioned");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assignDraft, setAssignDraft] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  async function handleToggleVisibility() {
    if (!segment) return;
    setActionError(null);
    const next: Visibility = segment.visibility === "public" ? "private" : "public";
    try {
      await updateSegment.mutateAsync({ id, visibility: next });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't update visibility."));
    }
  }

  async function handleAssignBlur() {
    const value = (assignDraft ?? "").trim();
    setAssignDraft(null);
    if (!segment || !value || value === segment.assignedToEmail) return;
    setActionError(null);
    try {
      await assignSegment.mutateAsync({ id, assignedToEmail: value });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't assign segment."));
    }
  }

  async function handleRefresh() {
    setActionError(null);
    try {
      await refreshSegment.mutateAsync({ id });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't refresh segment."));
    }
  }

  async function handleRunSourcingRule() {
    if (!segment?.owningSourcingRuleId) return;
    setActionError(null);
    try {
      await runSourcingRulePipeline.mutateAsync({ ruleId: segment.owningSourcingRuleId });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't run the sourcing rule."));
    }
  }

  async function handleDelete() {
    setActionError(null);
    try {
      await deleteSegment.mutateAsync({ id });
      onDeleted();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't delete segment."));
      setConfirmDelete(false);
    }
  }

  async function handleMarkActioned(contactId: string) {
    setActionError(null);
    try {
      await markActioned.mutateAsync({ contactId });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't mark contact as actioned."));
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back to segments"
        >
          <IconArrowLeft size={16} />
        </button>

        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : !segment ? (
          <p className="text-sm text-destructive">{loadError}</p>
        ) : (
          <>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <h1 className="truncate text-sm font-semibold text-foreground">{segment.name}</h1>
                <VisibilityBadge visibility={segment.visibility} />
              </div>
              <p className="text-xs text-muted-foreground">
                {contacts.length.toLocaleString()} contact{contacts.length === 1 ? "" : "s"} · {formatRelativeTime(segment.lastRefreshedAt)}
              </p>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <button
                type="button"
                onClick={handleToggleVisibility}
                disabled={updateSegment.isPending}
                className="rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
              >
                Make {segment.visibility === "public" ? "private" : "public"}
              </button>

              {segment.owningSourcingRuleId ? (
                <button
                  type="button"
                  onClick={handleRunSourcingRule}
                  disabled={runSourcingRulePipeline.isPending}
                  title={`This segment is populated by the sourcing rule "${segment.owningSourcingRuleName ?? "Unnamed rule"}" — run it now instead of a generic refresh`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  {runSourcingRulePipeline.isPending ? (
                    <IconLoader2 size={12} className="animate-spin" />
                  ) : (
                    <IconRefresh size={12} />
                  )}
                  Run sourcing rule
                </button>
              ) : (
                segment.personaId && (
                  <button
                    type="button"
                    onClick={handleRefresh}
                    disabled={refreshSegment.isPending}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    {refreshSegment.isPending ? (
                      <IconLoader2 size={12} className="animate-spin" />
                    ) : (
                      <IconRefresh size={12} />
                    )}
                    Refresh
                  </button>
                )
              )}

              {confirmDelete ? (
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleDelete}
                    disabled={deleteSegment.isPending}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    {deleteSegment.isPending ? "Deleting…" : "Confirm delete"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmDelete(false)}
                    className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted"
                  >
                    <IconX size={13} />
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(true)}
                  className="rounded-md p-1.5 text-muted-foreground/60 transition-colors hover:bg-muted hover:text-destructive"
                  aria-label="Delete segment"
                >
                  <IconTrash size={15} />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {!isLoading && segment && (isAdmin || segment.assignedToEmail) && (
        <div className="flex items-center gap-2 border-b border-border px-4 py-2.5">
          <span className="text-xs font-medium text-muted-foreground">Assigned to</span>
          {isAdmin ? (
            <>
              <input
                value={assignDraft ?? segment.assignedToEmail ?? ""}
                onChange={(e) => setAssignDraft(e.target.value)}
                onBlur={handleAssignBlur}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                placeholder="email@company.com"
                className="w-64 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
              />
              {assignSegment.isPending && <IconLoader2 size={12} className="animate-spin text-muted-foreground" />}
            </>
          ) : (
            <span className="text-xs text-foreground">{segment.assignedToEmail}</span>
          )}
        </div>
      )}

      {actionError && (
        <p className="border-b border-border bg-destructive/5 px-4 py-2 text-xs text-destructive">
          {actionError}
        </p>
      )}

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : loadError ? null : contacts.length === 0 ? (
          <div className="flex h-48 flex-col items-center justify-center gap-2 text-center">
            <IconUsers size={28} className="text-muted-foreground/30" />
            <p className="text-sm text-muted-foreground">No contacts in this segment</p>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-border bg-background text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Title</th>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Overall</th>
                <th className="px-4 py-2 font-medium">Persona match</th>
                <th className="px-4 py-2 font-medium">Company fit</th>
                <th className="px-4 py-2 font-medium">Engagement</th>
                <th className="px-4 py-2 font-medium">Reasoning</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {contacts.map((c) => (
                <tr key={c.id} className="border-b border-border/60">
                  <td className="max-w-[160px] truncate px-4 py-2.5 font-medium text-foreground" title={c.name}>
                    {c.name}
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-2.5 text-muted-foreground" title={c.title ?? undefined}>
                    {c.title ?? "—"}
                  </td>
                  <td className="max-w-[140px] truncate px-4 py-2.5 text-muted-foreground" title={c.company ?? undefined}>
                    {c.company ?? "—"}
                  </td>
                  <td className="px-4 py-2.5"><ScorePill score={c.overallScore} size="lg" breakdown={buildOverallScoreBreakdown(c)} /></td>
                  <td className="px-4 py-2.5"><ScorePill score={c.personaMatchScore} /></td>
                  <td className="px-4 py-2.5"><ScorePill score={c.companyFitScore} /></td>
                  <td className="px-4 py-2.5"><ScorePill score={c.engagementScore} /></td>
                  <td className="max-w-[220px] truncate px-4 py-2.5 text-muted-foreground/80" title={c.scoreReasoning ?? undefined}>
                    {c.scoreReasoning ?? "—"}
                  </td>
                  <td className="px-4 py-2.5">
                    <span
                      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
                        c.status === "actioned"
                          ? "bg-green-500/10 text-green-600 dark:text-green-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {c.status === "actioned" ? "Actioned" : "Active"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    {c.status === "active" && (
                      <button
                        type="button"
                        onClick={() => handleMarkActioned(c.id)}
                        disabled={markActioned.isPending}
                        className="rounded-md border border-border px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                      >
                        Mark actioned
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function SegmentsRoute() {
  const { data: roleData } = useActionQuery("get-my-role", {});
  const isAdmin = (roleData as { role?: string })?.role === "admin";

  const { data, isLoading, refetch } = useActionQuery("list-segments", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const segments: SegmentListRow[] = (data as { segments?: SegmentListRow[] })?.segments ?? [];

  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  if (viewingId) {
    return (
      <SegmentDetailView
        id={viewingId}
        isAdmin={isAdmin}
        onBack={() => {
          setViewingId(null);
          refetch();
        }}
        onDeleted={() => {
          setViewingId(null);
          refetch();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Segments</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : segments.length === 0
                ? "No segments yet — create one from a persona"
                : `${segments.length} segment${segments.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <IconPlus size={13} />
          New segment
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : segments.length === 0 ? (
          <div
            className="flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-center transition-colors hover:border-border/60 hover:bg-muted/20"
            onClick={() => setCreating(true)}
          >
            <IconLock size={32} className="text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No segments yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Pick a persona and a minimum match score to build your first list
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {segments.map((s) => (
              <SegmentCard key={s.id} segment={s} onOpen={() => setViewingId(s.id)} />
            ))}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground/50 transition-colors hover:border-border hover:text-muted-foreground"
            >
              <IconPlus size={22} />
              <span className="text-xs font-medium">New segment</span>
            </button>
          </div>
        )}
      </div>

      {creating && (
        <NewSegmentPanel onClose={() => setCreating(false)} onCreated={refetch} />
      )}
    </div>
  );
}
