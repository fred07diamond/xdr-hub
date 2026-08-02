import {
  callAction,
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconChevronRight,
  IconClock,
  IconFlag3,
  IconListDetails,
  IconLoader2,
  IconLock,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRadar,
  IconRefresh,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useRef, useState } from "react";

import { buildOverallScoreBreakdown, ScorePill } from "@/components/ScorePill";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Lists` }];
}

// ── Types ────────────────────────────────────────────────────────────────────

type Visibility = "private" | "public";
type RuleStatus = "active" | "paused";

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
  isActive: boolean;
  sourcingRuleId: string | null;
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

interface SubPersonaOption {
  id: string;
  personaId: string;
  name: string;
}

interface IcpOption {
  id: string;
  name: string;
  product: string | null;
}

interface FocusAccountOption {
  id: string;
  companyName: string;
  companyDomain: string | null;
  tier: string | null;
}

interface SourcingRule {
  id: string;
  name: string;
  ownerEmail: string;
  personaId: string;
  subPersonaId: string | null;
  icpId: string | null;
  companyAllowList: string | null;
  companyDenyList: string | null;
  desiredVolume: number;
  readyByTime: string;
  leadHours: number;
  segmentId: string;
  jobResourcePath: string | null;
  status: RuleStatus;
  createdAt: string | null;
  personaName: string | null;
  subPersonaName: string | null;
  icpName: string | null;
  contactCount: number;
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

function parseListInput(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function safeParseList(json: string | null): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string")
      : [];
  } catch {
    return [];
  }
}

function sameList(a: string[], b: string[]) {
  return JSON.stringify(a) === JSON.stringify(b);
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

// Deliberately a different color scheme from VisibilityBadge (violet/amber
// vs. sky/muted) so Static/Active never gets visually confused with
// Private/Public — the two are unrelated axes on the same list.
function ListTypeBadge({ isActive }: { isActive: boolean }) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isActive
          ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
          : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
      }`}
    >
      {isActive ? "Active" : "Static"}
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

function StatusBadge({ status }: { status: RuleStatus }) {
  const isActive = status === "active";
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
        isActive
          ? "bg-green-500/10 text-green-600 dark:text-green-400"
          : "bg-muted text-muted-foreground"
      }`}
    >
      {isActive ? "Running" : "Paused"}
    </span>
  );
}

// ── List card (list view) ────────────────────────────────────────────────────

function ListCard({
  list,
  onOpen,
}: {
  list: SegmentListRow;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex flex-col gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-colors hover:border-ring"
      style={list.personaColor ? { borderTop: `4px solid ${list.personaColor}` } : undefined}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">
          {list.name}
        </p>
        <IconChevronRight size={14} className="mt-0.5 shrink-0 text-muted-foreground/40" />
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        <ListTypeBadge isActive={list.isActive} />
        <VisibilityBadge visibility={list.visibility} />
        {list.personaName && (
          <PersonaBadge name={list.personaName} color={list.personaColor} />
        )}
      </div>

      <div className="mt-auto flex items-center gap-1.5 text-xs text-muted-foreground">
        <IconUsers size={13} />
        {list.contactCount.toLocaleString()} contact{list.contactCount === 1 ? "" : "s"}
      </div>

      {list.assignedToEmail && (
        <p className="truncate text-[11px] text-muted-foreground/70">
          Assigned to {list.assignedToEmail}
        </p>
      )}

      <p className="text-[11px] text-muted-foreground/50">
        {formatRelativeTime(list.lastRefreshedAt)}
      </p>
    </button>
  );
}

// ── New list flow ────────────────────────────────────────────────────────────

type NewListType = "static" | "active";

function NewListTypeChoice({
  onClose,
  onChoose,
}: {
  onClose: () => void;
  onChoose: (type: NewListType) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">New list</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 p-5 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => onChoose("static")}
            className="flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:border-ring hover:bg-muted/30"
          >
            <IconLock size={20} className="text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Static list</p>
            <p className="text-xs text-muted-foreground">
              Manually curated from a persona and a minimum match score. Contacts only change when you refresh it.
            </p>
          </button>
          <button
            type="button"
            onClick={() => onChoose("active")}
            className="flex flex-col items-start gap-2 rounded-xl border border-border p-4 text-left transition-colors hover:border-ring hover:bg-muted/30"
          >
            <IconRadar size={20} className="text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Active list</p>
            <p className="text-xs text-muted-foreground">
              Auto-populated on a schedule by a sourcing rule targeting a persona and companies.
            </p>
          </button>
        </div>
      </div>
    </div>
  );
}

function NewSegmentPanel({
  onClose,
  onCreated,
  onBack,
}: {
  onClose: () => void;
  onCreated: () => void;
  onBack: () => void;
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
      setError(errorMessage(err, "Couldn't create list."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <button type="button" onClick={onBack} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Back">
            <IconArrowLeft size={16} />
          </button>
          <h2 className="flex-1 text-sm font-semibold text-foreground">New static list</h2>
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
            Create list
          </button>
        </div>
      </div>
    </div>
  );
}

function NewActiveListPanel({
  onClose,
  onCreated,
  onBack,
}: {
  onClose: () => void;
  onCreated: () => void;
  onBack: () => void;
}) {
  const { data: personaData, isLoading: personasLoading } = useActionQuery(
    "list-personas",
    {},
  );
  const personas: PersonaOption[] =
    (personaData as { personas?: PersonaOption[] })?.personas ?? [];

  const { data: icpData, isLoading: icpsLoading } = useActionQuery(
    "list-icps",
    {},
  );
  const icps: IcpOption[] =
    (icpData as { icps?: IcpOption[] })?.icps ?? [];

  const { data: focusAccountData, isLoading: focusAccountsLoading } = useActionQuery(
    "list-focus-accounts",
    {},
  );
  const focusAccounts: FocusAccountOption[] =
    (focusAccountData as { focusAccounts?: FocusAccountOption[] })?.focusAccounts ?? [];

  const createSourcingRule = useActionMutation("create-sourcing-rule");

  const [name, setName] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [subPersonaId, setSubPersonaId] = useState("");
  const [icpId, setIcpId] = useState("");
  const [allowListText, setAllowListText] = useState("");
  const [denyListText, setDenyListText] = useState("");
  const [selectedFocusAccountIds, setSelectedFocusAccountIds] = useState<Set<string>>(new Set());
  const [desiredVolume, setDesiredVolume] = useState(20);
  const [readyByTime, setReadyByTime] = useState("");
  const [leadHours, setLeadHours] = useState(3);
  const [error, setError] = useState<string | null>(null);

  const { data: subPersonaData, isLoading: subPersonasLoading } = useActionQuery(
    "list-sub-personas",
    { personaId },
    { enabled: !!personaId },
  );
  const subPersonas: SubPersonaOption[] =
    (subPersonaData as { subPersonas?: SubPersonaOption[] })?.subPersonas ?? [];

  function handlePersonaChange(nextPersonaId: string) {
    setPersonaId(nextPersonaId);
    setSubPersonaId("");
  }

  function toggleFocusAccount(id: string) {
    setSelectedFocusAccountIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const canCreate = Boolean(name.trim() && personaId && readyByTime);

  async function handleCreate() {
    setError(null);
    if (!canCreate) return;
    // Focus-Accounts-based targeting is an alternative/addition to the
    // free-text allow-list, not a replacement — merge both into one array
    // and dedupe so a company picked both ways isn't sent twice.
    const freeTextAllowList = parseListInput(allowListText);
    const focusAccountNames = focusAccounts
      .filter((a) => selectedFocusAccountIds.has(a.id))
      .map((a) => a.companyName);
    const mergedAllowList = Array.from(new Set([...freeTextAllowList, ...focusAccountNames]));
    try {
      await createSourcingRule.mutateAsync({
        name: name.trim(),
        personaId,
        subPersonaId: subPersonaId || undefined,
        icpId: icpId || undefined,
        companyAllowList: mergedAllowList.length ? mergedAllowList : undefined,
        companyDenyList: parseListInput(denyListText).length
          ? parseListInput(denyListText)
          : undefined,
        desiredVolume,
        readyByTime,
        leadHours,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't create active list."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          <button type="button" onClick={onBack} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Back">
            <IconArrowLeft size={16} />
          </button>
          <h2 className="flex-1 text-sm font-semibold text-foreground">New active list</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily VP Eng outbound"
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
                onChange={(e) => handlePersonaChange(e.target.value)}
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

          {personaId && (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Sub-persona (optional)
              </label>
              {subPersonasLoading ? (
                <div className="flex h-9 items-center text-xs text-muted-foreground">
                  <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading sub-personas…
                </div>
              ) : (
                <select
                  value={subPersonaId}
                  onChange={(e) => setSubPersonaId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                >
                  <option value="">No sub-persona</option>
                  {subPersonas.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </select>
              )}
            </div>
          )}

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              ICP (optional)
            </label>
            {icpsLoading ? (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
                <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading ICPs…
              </div>
            ) : icps.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No ICPs yet — create one on the ICPs page to add company-level criteria.
              </p>
            ) : (
              <select
                value={icpId}
                onChange={(e) => setIcpId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No ICP</option>
                {icps.map((icp) => (
                  <option key={icp.id} value={icp.id}>
                    {icp.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Desired volume
              </label>
              <input
                type="number"
                min={1}
                max={200}
                value={desiredVolume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDesiredVolume(Number.isFinite(v) ? Math.min(200, Math.max(1, v)) : 1);
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Lead hours
              </label>
              <input
                type="number"
                min={1}
                max={12}
                value={leadHours}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLeadHours(Number.isFinite(v) ? Math.min(12, Math.max(1, v)) : 1);
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Ready-by time
            </label>
            <input
              type="time"
              value={readyByTime}
              onChange={(e) => setReadyByTime(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              The pipeline runs early enough for contacts to be ready by this time.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Company allow-list (optional)
            </label>
            <input
              value={allowListText}
              onChange={(e) => setAllowListText(e.target.value)}
              placeholder="Acme Inc, Globex Corp"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">Comma-separated company names.</p>
          </div>

          <div>
            <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              <IconFlag3 size={13} />
              Focus Accounts (optional)
            </label>
            {focusAccountsLoading ? (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
                <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading focus accounts…
              </div>
            ) : focusAccounts.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No focus accounts yet — add some on the Focus Accounts page to target them here.
              </p>
            ) : (
              <div className="flex max-h-36 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
                {focusAccounts.map((a) => (
                  <label
                    key={a.id}
                    className="flex items-center gap-2 rounded px-1.5 py-1 text-xs text-foreground hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={selectedFocusAccountIds.has(a.id)}
                      onChange={() => toggleFocusAccount(a.id)}
                      className="size-3.5 rounded border-border"
                    />
                    <span className="truncate">{a.companyName}</span>
                  </label>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-muted-foreground/60">
              Checked accounts are merged into the company allow-list above alongside any manual entries.
            </p>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Company deny-list (optional)
            </label>
            <input
              value={denyListText}
              onChange={(e) => setDenyListText(e.target.value)}
              placeholder="Existing Customer Co"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
            <p className="mt-1 text-[11px] text-muted-foreground/60">Comma-separated company names.</p>
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
            disabled={!canCreate || createSourcingRule.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {createSourcingRule.isPending && <IconLoader2 size={12} className="animate-spin" />}
            Create active list
          </button>
        </div>
      </div>
    </div>
  );
}

function NewListPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [type, setType] = useState<NewListType | null>(null);

  if (!type) {
    return <NewListTypeChoice onClose={onClose} onChoose={setType} />;
  }
  if (type === "static") {
    return <NewSegmentPanel onClose={onClose} onCreated={onCreated} onBack={() => setType(null)} />;
  }
  return <NewActiveListPanel onClose={onClose} onCreated={onCreated} onBack={() => setType(null)} />;
}

// ── Edit rule panel (relocated from sourcing-rules.tsx, unchanged) ──────────

function EditRulePanel({
  rule,
  onClose,
  onUpdated,
}: {
  rule: SourcingRule;
  onClose: () => void;
  onUpdated: () => void;
}) {
  const updateSourcingRule = useActionMutation("update-sourcing-rule");

  const { data: icpData, isLoading: icpsLoading } = useActionQuery(
    "list-icps",
    {},
  );
  const icps: IcpOption[] =
    (icpData as { icps?: IcpOption[] })?.icps ?? [];

  const initialAllowList = safeParseList(rule.companyAllowList);
  const initialDenyList = safeParseList(rule.companyDenyList);
  const initialIcpId = rule.icpId ?? "";

  const [name, setName] = useState(rule.name);
  const [icpId, setIcpId] = useState(initialIcpId);
  const [allowListText, setAllowListText] = useState(initialAllowList.join(", "));
  const [denyListText, setDenyListText] = useState(initialDenyList.join(", "));
  const [desiredVolume, setDesiredVolume] = useState(rule.desiredVolume);
  const [readyByTime, setReadyByTime] = useState(rule.readyByTime);
  const [leadHours, setLeadHours] = useState(rule.leadHours);
  const [error, setError] = useState<string | null>(null);

  const nextAllowList = parseListInput(allowListText);
  const nextDenyList = parseListInput(denyListText);

  const hasChanges =
    name.trim() !== rule.name ||
    icpId !== initialIcpId ||
    !sameList(nextAllowList, initialAllowList) ||
    !sameList(nextDenyList, initialDenyList) ||
    desiredVolume !== rule.desiredVolume ||
    readyByTime !== rule.readyByTime ||
    leadHours !== rule.leadHours;

  const canSave = Boolean(name.trim() && readyByTime) && hasChanges;

  async function handleSave() {
    setError(null);
    if (!canSave) return;

    const payload = {
      id: rule.id,
      ...(name.trim() !== rule.name ? { name: name.trim() } : {}),
      ...(icpId !== initialIcpId ? { icpId: icpId || null } : {}),
      ...(!sameList(nextAllowList, initialAllowList) ? { companyAllowList: nextAllowList } : {}),
      ...(!sameList(nextDenyList, initialDenyList) ? { companyDenyList: nextDenyList } : {}),
      ...(desiredVolume !== rule.desiredVolume ? { desiredVolume } : {}),
      ...(readyByTime !== rule.readyByTime ? { readyByTime } : {}),
      ...(leadHours !== rule.leadHours ? { leadHours } : {}),
    };

    try {
      const result = await updateSourcingRule.mutateAsync(payload);
      if ((result as { ok?: boolean; error?: string })?.ok === false) {
        setError((result as { error: string }).error);
        return;
      }
      onUpdated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't update sourcing rule."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">Edit automation settings</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              ICP (optional)
            </label>
            {icpsLoading ? (
              <div className="flex h-9 items-center text-xs text-muted-foreground">
                <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading ICPs…
              </div>
            ) : icps.length === 0 ? (
              <p className="text-xs text-muted-foreground/60">
                No ICPs yet — create one on the ICPs page to add company-level criteria.
              </p>
            ) : (
              <select
                value={icpId}
                onChange={(e) => setIcpId(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="">No ICP</option>
                {icps.map((icp) => (
                  <option key={icp.id} value={icp.id}>
                    {icp.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Desired volume
              </label>
              <input
                type="number"
                min={1}
                max={200}
                value={desiredVolume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setDesiredVolume(Number.isFinite(v) ? Math.min(200, Math.max(1, v)) : 1);
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Lead hours
              </label>
              <input
                type="number"
                min={1}
                max={12}
                value={leadHours}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setLeadHours(Number.isFinite(v) ? Math.min(12, Math.max(1, v)) : 1);
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Ready-by time
            </label>
            <input
              type="time"
              value={readyByTime}
              onChange={(e) => setReadyByTime(e.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Company allow-list
            </label>
            <input
              value={allowListText}
              onChange={(e) => setAllowListText(e.target.value)}
              placeholder="Acme Inc, Globex Corp"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
              Company deny-list
            </label>
            <input
              value={denyListText}
              onChange={(e) => setDenyListText(e.target.value)}
              placeholder="Existing Customer Co"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={!canSave || updateSourcingRule.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {updateSourcingRule.isPending && <IconLoader2 size={12} className="animate-spin" />}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}

// ── List detail view ─────────────────────────────────────────────────────────

function ListDetailView({
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
    ? errorMessage(error, "Couldn't load this list.")
    : null;

  // When this list is Active, the owning sourcing rule's own fields (target,
  // schedule, filters, status) live in list-sourcing-rules rather than
  // get-segment — fetched only when needed, and cached/shared with any other
  // place on this page that queries the same action.
  const { data: rulesData, refetch: refetchRules } = useActionQuery(
    "list-sourcing-rules",
    {},
    { enabled: !!segment?.owningSourcingRuleId, refetchInterval: 30000, staleTime: 25000 },
  );
  const rules: SourcingRule[] = (rulesData as { rules?: SourcingRule[] })?.rules ?? [];
  const rule = segment?.owningSourcingRuleId
    ? rules.find((r) => r.id === segment.owningSourcingRuleId) ?? null
    : null;

  const { data: personaData } = useActionQuery(
    "list-personas",
    {},
    { enabled: !!segment?.owningSourcingRuleId },
  );
  const personaColorById = new Map(
    ((personaData as { personas?: PersonaOption[] })?.personas ?? []).map((p) => [p.id, p.color]),
  );

  const updateSegment = useActionMutation("update-segment");
  const assignSegment = useActionMutation("assign-segment");
  const refreshSegment = useActionMutation("refresh-segment");
  const deleteSegment = useActionMutation("delete-segment");
  const markActioned = useActionMutation("mark-contact-actioned");
  const updateSourcingRule = useActionMutation("update-sourcing-rule");
  const deleteSourcingRule = useActionMutation("delete-sourcing-rule");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [assignDraft, setAssignDraft] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [ruleActionError, setRuleActionError] = useState<string | null>(null);
  const [isRunningSourcingRule, setIsRunningSourcingRule] = useState(false);
  const [editingRule, setEditingRule] = useState(false);

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
      setActionError(errorMessage(err, "Couldn't assign list."));
    }
  }

  async function handleRefresh() {
    setActionError(null);
    try {
      await refreshSegment.mutateAsync({ id });
      refetch();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't refresh list."));
    }
  }

  async function handleRunSourcingRule() {
    if (!segment?.owningSourcingRuleId) return;
    setActionError(null);
    setIsRunningSourcingRule(true);
    try {
      // The pipeline scores every matched contact sequentially (an AI call
      // plus CommonRoom lookups per contact) — routinely well past
      // useActionMutation's default 60s timeout for anything but a tiny
      // desiredVolume. callAction lets us override it explicitly instead of
      // the UI silently sitting on a spinner past the point a real timeout
      // would otherwise fire with no explanation.
      await callAction("run-sourcing-rule-pipeline", { ruleId: segment.owningSourcingRuleId }, { timeoutMs: 300_000 });
      refetch();
      refetchRules();
    } catch (err) {
      setActionError(errorMessage(err, "Couldn't run the sourcing rule."));
    } finally {
      setIsRunningSourcingRule(false);
    }
  }

  async function handleToggleRuleStatus() {
    if (!rule) return;
    setRuleActionError(null);
    const nextStatus: RuleStatus = rule.status === "active" ? "paused" : "active";
    try {
      const result = await updateSourcingRule.mutateAsync({ id: rule.id, status: nextStatus });
      if ((result as { ok?: boolean; error?: string })?.ok === false) {
        setRuleActionError((result as { error: string }).error);
        return;
      }
      refetchRules();
    } catch (err) {
      setRuleActionError(errorMessage(err, "Couldn't update the rule's status."));
    }
  }

  // Deleting an Active list is two independent mutations with no shared
  // transaction between them — delete-sourcing-rule (stop automation + drop
  // the job resource) then delete-segment (drop the segment/contacts). If
  // the first succeeds but the second then fails (network blip, a future
  // writability check, etc.), the rule is already gone but the segment
  // survives. ruleDeletedRef records that so a retry skips straight to
  // deleteSegment instead of re-attempting a delete against a now-nonexistent
  // rule id — which would otherwise soft-fail with a confusing "not found"
  // error and never reach the segment delete at all. (Without this ref,
  // navigating away and back would eventually self-heal too, since a
  // fresh get-segment fetch reports owningSourcingRuleId: null once the rule
  // is gone — but that recovery path is invisible to the user in the
  // moment, so we make the retry work correctly immediately instead.)
  const ruleDeletedRef = useRef(false);

  async function handleDelete() {
    setActionError(null);

    if (segment?.owningSourcingRuleId && !ruleDeletedRef.current) {
      try {
        const ruleResult = await deleteSourcingRule.mutateAsync({ id: segment.owningSourcingRuleId });
        if ((ruleResult as { ok?: boolean; error?: string })?.ok === false) {
          setActionError((ruleResult as { error: string }).error);
          setConfirmDelete(false);
          return;
        }
        ruleDeletedRef.current = true;
      } catch (err) {
        setActionError(errorMessage(err, "Couldn't stop this list's automation."));
        setConfirmDelete(false);
        return;
      }
    }

    try {
      await deleteSegment.mutateAsync({ id });
      onDeleted();
    } catch (err) {
      setActionError(
        ruleDeletedRef.current
          ? "Automation removed, but couldn't delete the list — click delete again to finish."
          : errorMessage(err, "Couldn't delete list."),
      );
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

  const isDeleting = deleteSegment.isPending || deleteSourcingRule.isPending;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          className="flex size-7 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label="Back to lists"
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
                <ListTypeBadge isActive={!!segment.owningSourcingRuleId} />
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
                  disabled={isRunningSourcingRule}
                  title={`This list is populated by the sourcing rule "${segment.owningSourcingRuleName ?? "Unnamed rule"}" — run it now instead of a generic refresh`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                >
                  {isRunningSourcingRule ? (
                    <IconLoader2 size={12} className="animate-spin" />
                  ) : (
                    <IconRefresh size={12} />
                  )}
                  {isRunningSourcingRule ? "Running…" : "Run sourcing rule"}
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
                    disabled={isDeleting}
                    className="rounded-md px-2.5 py-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
                  >
                    {isDeleting ? "Deleting…" : "Confirm delete"}
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
                  aria-label="Delete list"
                >
                  <IconTrash size={15} />
                </button>
              )}
            </div>
          </>
        )}
      </div>

      {!isLoading && segment && segment.owningSourcingRuleId && (
        <div className="border-b border-border px-4 py-3">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Automation
            </h2>
            {rule && (
              <div className="flex items-center gap-1.5">
                <StatusBadge status={rule.status} />
                <button
                  type="button"
                  onClick={handleToggleRuleStatus}
                  disabled={updateSourcingRule.isPending}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
                  aria-label={rule.status === "active" ? "Pause rule" : "Resume rule"}
                  title={rule.status === "active" ? "Pause rule" : "Resume rule"}
                >
                  {rule.status === "active" ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
                </button>
                <button
                  type="button"
                  onClick={() => setEditingRule(true)}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Edit automation settings"
                  title="Edit automation settings"
                >
                  <IconPencil size={14} />
                </button>
              </div>
            )}
          </div>

          {ruleActionError && <p className="mb-2 text-xs text-destructive">{ruleActionError}</p>}

          {!rule ? (
            <p className="text-xs text-muted-foreground/60">Loading automation settings…</p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
                {rule.personaName && (
                  <PersonaBadge name={rule.personaName} color={personaColorById.get(rule.personaId) ?? null} />
                )}
                {rule.subPersonaName && <span>› {rule.subPersonaName}</span>}
                {rule.icpName && <span className="text-muted-foreground/70">ICP: {rule.icpName}</span>}
                <span className="inline-flex items-center gap-1">
                  <IconUsers size={12} /> {rule.desiredVolume} desired
                </span>
                <span className="inline-flex items-center gap-1">
                  <IconClock size={12} /> Ready by {rule.readyByTime}
                </span>
                <span>{rule.leadHours}h lead</span>
              </div>
              {(safeParseList(rule.companyAllowList).length > 0 || safeParseList(rule.companyDenyList).length > 0) && (
                <div className="mt-1.5 flex flex-col gap-0.5 text-[11px] text-muted-foreground/70">
                  {safeParseList(rule.companyAllowList).length > 0 && (
                    <p>Allow: {safeParseList(rule.companyAllowList).join(", ")}</p>
                  )}
                  {safeParseList(rule.companyDenyList).length > 0 && (
                    <p>Deny: {safeParseList(rule.companyDenyList).join(", ")}</p>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

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
            <p className="text-sm text-muted-foreground">No contacts in this list</p>
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

      {editingRule && rule && (
        <EditRulePanel
          rule={rule}
          onClose={() => setEditingRule(false)}
          onUpdated={() => refetchRules()}
        />
      )}
    </div>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function ListsRoute() {
  const { data: roleData } = useActionQuery("get-my-role", {});
  const isAdmin = (roleData as { role?: string })?.role === "admin";

  const { data, isLoading, refetch } = useActionQuery("list-segments", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const lists: SegmentListRow[] = (data as { segments?: SegmentListRow[] })?.segments ?? [];

  const [creating, setCreating] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);

  if (viewingId) {
    return (
      <ListDetailView
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
          <h1 className="text-sm font-semibold text-foreground">Lists</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : lists.length === 0
                ? "No lists yet — create a static list from a persona, or an active list on a schedule"
                : `${lists.length} list${lists.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <IconPlus size={13} />
          New list
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : lists.length === 0 ? (
          <div
            className="flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-center transition-colors hover:border-border/60 hover:bg-muted/20"
            onClick={() => setCreating(true)}
          >
            <IconListDetails size={32} className="text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No lists yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Create a static list from a persona, or an active list to auto-populate on a schedule
              </p>
            </div>
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {lists.map((s) => (
              <ListCard key={s.id} list={s} onOpen={() => setViewingId(s.id)} />
            ))}
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="flex min-h-[160px] flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border text-muted-foreground/50 transition-colors hover:border-border hover:text-muted-foreground"
            >
              <IconPlus size={22} />
              <span className="text-xs font-medium">New list</span>
            </button>
          </div>
        )}
      </div>

      {creating && (
        <NewListPanel onClose={() => setCreating(false)} onCreated={refetch} />
      )}
    </div>
  );
}
