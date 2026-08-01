import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconClock,
  IconExternalLink,
  IconLoader2,
  IconPencil,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlus,
  IconRadar,
  IconTrash,
  IconUsers,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";
import { Link } from "react-router";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Sourcing rules` }];
}

// ── Types ────────────────────────────────────────────────────────────────────

type RuleStatus = "active" | "paused";

interface SourcingRule {
  id: string;
  name: string;
  ownerEmail: string;
  personaId: string;
  subPersonaId: string | null;
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
  contactCount: number;
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

// ── Helpers ──────────────────────────────────────────────────────────────────

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
      {isActive ? "Active" : "Paused"}
    </span>
  );
}

// ── New rule panel ───────────────────────────────────────────────────────────

function NewRulePanel({
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

  const createSourcingRule = useActionMutation("create-sourcing-rule");

  const [name, setName] = useState("");
  const [personaId, setPersonaId] = useState("");
  const [subPersonaId, setSubPersonaId] = useState("");
  const [allowListText, setAllowListText] = useState("");
  const [denyListText, setDenyListText] = useState("");
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

  const canCreate = Boolean(name.trim() && personaId && readyByTime);

  async function handleCreate() {
    setError(null);
    if (!canCreate) return;
    try {
      await createSourcingRule.mutateAsync({
        name: name.trim(),
        personaId,
        subPersonaId: subPersonaId || undefined,
        companyAllowList: parseListInput(allowListText).length
          ? parseListInput(allowListText)
          : undefined,
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
      setError(errorMessage(err, "Couldn't create sourcing rule."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">New sourcing rule</h2>
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
            Create rule
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Edit rule panel ──────────────────────────────────────────────────────────

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

  const initialAllowList = safeParseList(rule.companyAllowList);
  const initialDenyList = safeParseList(rule.companyDenyList);

  const [name, setName] = useState(rule.name);
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
          <h2 className="text-sm font-semibold text-foreground">Edit sourcing rule</h2>
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

// ── Rule row ─────────────────────────────────────────────────────────────────

function RuleRow({
  rule,
  personaColor,
  onRefetch,
  onEdit,
}: {
  rule: SourcingRule;
  personaColor: string | null;
  onRefetch: () => void;
  onEdit: () => void;
}) {
  const updateSourcingRule = useActionMutation("update-sourcing-rule");
  const deleteSourcingRule = useActionMutation("delete-sourcing-rule");

  const [confirmDelete, setConfirmDelete] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function handleToggleStatus() {
    setRowError(null);
    const nextStatus: RuleStatus = rule.status === "active" ? "paused" : "active";
    try {
      const result = await updateSourcingRule.mutateAsync({ id: rule.id, status: nextStatus });
      if ((result as { ok?: boolean; error?: string })?.ok === false) {
        setRowError((result as { error: string }).error);
        return;
      }
      onRefetch();
    } catch (err) {
      setRowError(errorMessage(err, "Couldn't update status."));
    }
  }

  async function handleDelete() {
    setRowError(null);
    try {
      const result = await deleteSourcingRule.mutateAsync({ id: rule.id });
      if ((result as { ok?: boolean; error?: string })?.ok === false) {
        alert((result as { error: string }).error);
        setConfirmDelete(false);
        return;
      }
      onRefetch();
    } catch (err) {
      alert(errorMessage(err, "Couldn't delete sourcing rule."));
      setConfirmDelete(false);
    }
  }

  return (
    <tr className="border-b border-border/60 align-top">
      <td className="max-w-[200px] px-4 py-3">
        <p className="truncate text-sm font-medium text-foreground" title={rule.name}>
          {rule.name}
        </p>
        {rowError && <p className="mt-1 text-[11px] text-destructive">{rowError}</p>}
      </td>
      <td className="max-w-[220px] px-4 py-3">
        <div className="flex flex-col gap-1">
          {rule.personaName ? (
            <PersonaBadge name={rule.personaName} color={personaColor} />
          ) : (
            <span className="text-xs text-muted-foreground/50">—</span>
          )}
          {rule.subPersonaName && (
            <span className="truncate text-[11px] text-muted-foreground" title={rule.subPersonaName}>
              › {rule.subPersonaName}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{rule.desiredVolume}</td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1">
          <IconClock size={12} />
          {rule.readyByTime}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">{rule.leadHours}h lead</td>
      <td className="px-4 py-3">
        <StatusBadge status={rule.status} />
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        <Link
          to="/segments"
          className="inline-flex items-center gap-1 text-primary hover:underline"
          title="View this rule's segment on the Segments page"
        >
          <IconUsers size={13} />
          {rule.contactCount.toLocaleString()}
          <IconExternalLink size={11} />
        </Link>
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex items-center justify-end gap-1">
          <button
            type="button"
            onClick={handleToggleStatus}
            disabled={updateSourcingRule.isPending}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-40"
            aria-label={rule.status === "active" ? "Pause rule" : "Resume rule"}
            title={rule.status === "active" ? "Pause rule" : "Resume rule"}
          >
            {rule.status === "active" ? <IconPlayerPause size={14} /> : <IconPlayerPlay size={14} />}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            aria-label="Edit rule"
            title="Edit rule"
          >
            <IconPencil size={14} />
          </button>
          {confirmDelete ? (
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleDelete}
                disabled={deleteSourcingRule.isPending}
                className="rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
              >
                {deleteSourcingRule.isPending ? "Deleting…" : "Confirm"}
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
              className="rounded-md p-1.5 text-muted-foreground/50 transition-colors hover:bg-muted hover:text-destructive"
              aria-label="Delete rule"
              title="Delete rule"
            >
              <IconTrash size={14} />
            </button>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function SourcingRulesRoute() {
  const { data, isLoading, refetch } = useActionQuery("list-sourcing-rules", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const rules: SourcingRule[] = (data as { rules?: SourcingRule[] })?.rules ?? [];

  // list-sourcing-rules doesn't return each persona's color, so fetch personas
  // separately (already cheap and cached — NewRulePanel queries the same
  // action) purely to color-match the target badges, mirroring how personas
  // render their own color everywhere else in this app.
  const { data: personaData } = useActionQuery("list-personas", {});
  const personaColorById = new Map(
    ((personaData as { personas?: PersonaOption[] })?.personas ?? []).map((p) => [p.id, p.color]),
  );

  const [creating, setCreating] = useState(false);
  const [editingRule, setEditingRule] = useState<SourcingRule | null>(null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Sourcing rules</h1>
          <p className="text-xs text-muted-foreground">
            {isLoading
              ? "Loading…"
              : rules.length === 0
                ? "No sourcing rules yet — schedule the Prospector pipeline against a persona"
                : `${rules.length} rule${rules.length === 1 ? "" : "s"}`}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <IconPlus size={13} />
          New rule
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : rules.length === 0 ? (
          <div
            className="mx-4 mt-4 flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-center transition-colors hover:border-border/60 hover:bg-muted/20"
            onClick={() => setCreating(true)}
          >
            <IconRadar size={32} className="text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No sourcing rules yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Pick a persona and a ready-by time to schedule daily prospecting runs
              </p>
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-border bg-background text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Target</th>
                <th className="px-4 py-2 font-medium">Volume</th>
                <th className="px-4 py-2 font-medium">Ready by</th>
                <th className="px-4 py-2 font-medium">Lead</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Contacts</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <RuleRow
                  key={rule.id}
                  rule={rule}
                  personaColor={personaColorById.get(rule.personaId) ?? null}
                  onRefetch={refetch}
                  onEdit={() => setEditingRule(rule)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <NewRulePanel onClose={() => setCreating(false)} onCreated={refetch} />
      )}

      {editingRule && (
        <EditRulePanel
          rule={editingRule}
          onClose={() => setEditingRule(null)}
          onUpdated={refetch}
        />
      )}
    </div>
  );
}
