import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconChevronLeft,
  IconExternalLink,
  IconGauge,
  IconLoader2,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useMemo, useState } from "react";

import { DonutBreakdown, EmptyState } from "@/components/DonutBreakdown";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Pull Plans` }];
}

// Same recurring-cadence options as lists.tsx's sourcing/marketing rule
// forms (INTERVAL_HOURS_OPTIONS there) -- duplicated rather than imported
// since that file doesn't export it and it's already duplicated 4 times
// within that file itself.
const INTERVAL_HOURS_OPTIONS: { value: number; label: string }[] = [
  { value: 1, label: "Every hour" },
  { value: 2, label: "Every 2 hours" },
  { value: 3, label: "Every 3 hours" },
  { value: 4, label: "Every 4 hours" },
  { value: 6, label: "Every 6 hours" },
  { value: 8, label: "Every 8 hours" },
  { value: 12, label: "Every 12 hours" },
  { value: 24, label: "Once a day (24 hours)" },
];

const DEFAULT_PERSONA_COLOR = "#94a3b8";

interface PersonaOption {
  id: string;
  name: string;
  color: string | null;
  liAgentPersonaId: string | null;
}

interface MixRow {
  personaId: string;
  targetPercent: number;
}

interface PullPlan {
  id: string;
  name: string;
  totalVolume: number;
  intervalHours: number;
  status: string;
  hasHubspot: boolean;
  personaMix: Array<{ personaId: string; targetPercent: number; name: string; color: string | null }>;
}

// Linked-slider redistribution: moving one persona's slider shifts the
// difference proportionally across the others (evenly if they're all at 0),
// so the mix always sums to exactly 100 without the user having to manually
// balance every other row themselves.
function redistribute(mix: MixRow[], changedId: string, newValue: number): MixRow[] {
  const clamped = Math.max(0, Math.min(100, Math.round(newValue)));
  const others = mix.filter((m) => m.personaId !== changedId);
  if (others.length === 0) {
    return mix.map((m) => (m.personaId === changedId ? { ...m, targetPercent: 100 } : m));
  }

  const remaining = 100 - clamped;
  const othersTotal = others.reduce((sum, m) => sum + m.targetPercent, 0);
  const nextOthers = others.map((m) => ({
    ...m,
    targetPercent: othersTotal > 0 ? Math.round((m.targetPercent / othersTotal) * remaining) : Math.round(remaining / others.length),
  }));

  // Rounding can leave the total off by a point or two -- correct it on the
  // largest "other" row so the sum is always exactly 100, never 99 or 101.
  const drift = 100 - (clamped + nextOthers.reduce((sum, m) => sum + m.targetPercent, 0));
  if (drift !== 0 && nextOthers.length > 0) {
    const largest = nextOthers.reduce((a, b) => (b.targetPercent > a.targetPercent ? b : a));
    largest.targetPercent = Math.max(0, Math.min(100, largest.targetPercent + drift));
  }

  return mix.map((m) => {
    if (m.personaId === changedId) return { ...m, targetPercent: clamped };
    const updated = nextOthers.find((o) => o.personaId === m.personaId);
    return updated ?? m;
  });
}

function equalSplit(personaIds: string[]): MixRow[] {
  const n = personaIds.length;
  if (n === 0) return [];
  const base = Math.floor(100 / n);
  const remainder = 100 - base * n;
  return personaIds.map((personaId, i) => ({ personaId, targetPercent: base + (i < remainder ? 1 : 0) }));
}

function NewPullPlanPanel({
  personas,
  onClose,
  onCreated,
}: {
  personas: PersonaOption[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [name, setName] = useState("");
  const [totalVolume, setTotalVolume] = useState(50);
  const [intervalHours, setIntervalHours] = useState<number | "">("");
  const [includeHubspot, setIncludeHubspot] = useState(true);
  const [mix, setMix] = useState<MixRow[]>([]);
  const [addPersonaOpen, setAddPersonaOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const createPlan = useActionMutation("create-prospect-pull-plan");

  const personaById = useMemo(() => new Map(personas.map((p) => [p.id, p])), [personas]);
  const availablePersonas = personas.filter((p) => !mix.some((m) => m.personaId === p.id));
  const mixSum = mix.reduce((sum, m) => sum + m.targetPercent, 0);
  const canCreate = Boolean(name.trim() && intervalHours && mix.length > 0 && mixSum === 100);

  function addPersona(personaId: string) {
    setMix((prev) => equalSplit([...prev.map((m) => m.personaId), personaId]));
    setAddPersonaOpen(false);
  }

  function removePersona(personaId: string) {
    setMix((prev) => {
      const remaining = prev.filter((m) => m.personaId !== personaId).map((m) => m.personaId);
      return equalSplit(remaining);
    });
  }

  async function handleCreate() {
    if (!canCreate || typeof intervalHours !== "number") return;
    setError(null);
    try {
      await createPlan.mutateAsync({
        name: name.trim(),
        totalVolume,
        intervalHours,
        personaMix: mix,
        includeHubspot,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the plan — try again.");
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" role="dialog" aria-modal="true" aria-labelledby="new-pull-plan-title">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} aria-label="Back" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
              <IconChevronLeft size={16} />
            </button>
            <h2 id="new-pull-plan-title" className="text-sm font-semibold text-foreground">New Pull Plan</h2>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
          <div>
            <label htmlFor="pull-plan-name" className="mb-1.5 block text-xs font-medium text-muted-foreground">Name</label>
            <input
              id="pull-plan-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Daily prospect mix"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="pull-plan-volume" className="mb-1.5 block text-xs font-medium text-muted-foreground">Total volume</label>
              <input
                id="pull-plan-volume"
                type="number"
                min={1}
                max={1000}
                value={totalVolume}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setTotalVolume(Number.isFinite(v) ? Math.min(1000, Math.max(1, v)) : 1);
                }}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              />
            </div>
            <div>
              <label htmlFor="pull-plan-interval" className="mb-1.5 block text-xs font-medium text-muted-foreground">Run every</label>
              <select
                id="pull-plan-interval"
                value={intervalHours}
                onChange={(e) => setIntervalHours(e.target.value ? Number(e.target.value) : "")}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
              >
                <option value="" disabled>Select a cadence…</option>
                {INTERVAL_HOURS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>{opt.label}</option>
                ))}
              </select>
            </div>
          </div>
          <p className="-mt-2 text-[11px] text-muted-foreground/60">
            {totalVolume.toLocaleString()} new prospects every cycle, split by the mix below.
          </p>

          <label className="flex items-center gap-2 text-sm text-foreground">
            <input type="checkbox" checked={includeHubspot} onChange={(e) => setIncludeHubspot(e.target.checked)} className="size-3.5 rounded border-border" />
            Include HubSpot as a background contributor
          </label>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold uppercase text-muted-foreground">Persona mix</span>
              <Popover open={addPersonaOpen} onOpenChange={setAddPersonaOpen}>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    disabled={availablePersonas.length === 0}
                    className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-foreground transition-colors hover:bg-muted disabled:opacity-40"
                  >
                    <IconPlus size={12} /> Add persona
                  </button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-56 p-1">
                  {availablePersonas.length === 0 ? (
                    <p className="px-2 py-1.5 text-xs text-muted-foreground">Every persona is already in the mix.</p>
                  ) : (
                    availablePersonas.map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => addPersona(p.id)}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
                      >
                        <span className="size-2 shrink-0 rounded-full" style={{ background: p.color ?? DEFAULT_PERSONA_COLOR }} />
                        {p.name}
                      </button>
                    ))
                  )}
                </PopoverContent>
              </Popover>
            </div>

            {mix.length === 0 ? (
              <EmptyState icon={IconGauge} text="Add a persona to start building the mix." compact />
            ) : (
              <div className="space-y-3">
                {mix.map((m) => {
                  const persona = personaById.get(m.personaId);
                  return (
                    <div key={m.personaId} className="flex items-center gap-3">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: persona?.color ?? DEFAULT_PERSONA_COLOR }} />
                      <span className="w-24 shrink-0 truncate text-sm text-foreground">{persona?.name ?? "Unknown"}</span>
                      <Slider
                        value={[m.targetPercent]}
                        max={100}
                        step={1}
                        onValueChange={([v]) => setMix((prev) => redistribute(prev, m.personaId, v))}
                        aria-label={`${persona?.name ?? "Persona"} share of the mix`}
                        className="flex-1"
                      />
                      <span className="w-10 shrink-0 text-right text-xs font-medium tabular-nums text-foreground">{m.targetPercent}%</span>
                      <button
                        type="button"
                        onClick={() => removePersona(m.personaId)}
                        aria-label={`Remove ${persona?.name ?? "persona"} from the mix`}
                        className="shrink-0 rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-destructive"
                      >
                        <IconTrash size={13} />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {mix.length > 0 && (
            <div>
              <span className="mb-2 block text-xs font-semibold uppercase text-muted-foreground">Preview</span>
              <DonutBreakdown
                segments={mix.map((m) => ({
                  label: personaById.get(m.personaId)?.name ?? "Unknown",
                  value: m.targetPercent,
                  color: personaById.get(m.personaId)?.color ?? DEFAULT_PERSONA_COLOR,
                }))}
              />
            </div>
          )}

          {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border px-5 py-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleCreate} disabled={!canCreate || createPlan.isPending}>
            {createPlan.isPending ? <IconLoader2 size={14} className="animate-spin" /> : null}
            Create plan
          </Button>
        </div>
      </div>
    </div>
  );
}

function PlanProgress({ planId }: { planId: string }) {
  const { data, isLoading } = useActionQuery("get-prospect-pull-plan-progress", { planId }, { refetchInterval: 30000 });
  const progress = data as
    | {
        hasRun: boolean;
        breakdown: Array<{
          personaId: string;
          name: string;
          color: string | null;
          target: number;
          actual: number;
          shortfall: number;
          refillNudgeUrl: string | null;
        }>;
      }
    | undefined;

  if (isLoading) {
    return (
      <div className="flex h-16 items-center justify-center">
        <IconLoader2 size={16} className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!progress?.hasRun) {
    return <p className="py-3 text-xs text-muted-foreground">No reconcile run yet — this plan's first scheduled cycle hasn't fired.</p>;
  }

  return (
    <div className="space-y-3 py-3">
      <DonutBreakdown segments={progress.breakdown.map((b) => ({ label: b.name, value: b.actual, color: b.color ?? DEFAULT_PERSONA_COLOR }))} />
      <div className="space-y-1.5">
        {progress.breakdown.map((b) => (
          <div key={b.personaId} className="flex items-center justify-between text-xs">
            <span className="flex items-center gap-1.5">
              <span className="size-1.5 rounded-full" style={{ background: b.color ?? DEFAULT_PERSONA_COLOR }} />
              {b.name}
            </span>
            <span className="flex items-center gap-2 text-muted-foreground">
              <span className="tabular-nums">{b.actual} / {b.target}</span>
              {b.shortfall > 0 && b.refillNudgeUrl && (
                <a
                  href={b.refillNudgeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 hover:underline dark:text-amber-400"
                >
                  Refill {b.name} — {b.shortfall} more <IconExternalLink size={10} />
                </a>
              )}
              {b.shortfall > 0 && !b.refillNudgeUrl && (
                <span className="rounded-full bg-muted px-2 py-0.5 text-muted-foreground">Short by {b.shortfall}</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PlanCard({ plan, onDeleted }: { plan: PullPlan; onDeleted: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const deletePlan = useActionMutation("delete-prospect-pull-plan");

  async function handleDelete() {
    await deletePlan.mutateAsync({ id: plan.id });
    onDeleted();
  }

  const intervalLabel = INTERVAL_HOURS_OPTIONS.find((o) => o.value === plan.intervalHours)?.label ?? `Every ${plan.intervalHours}h`;

  return (
    <div className="rounded-xl border border-border bg-card shadow-sm">
      <button type="button" onClick={() => setExpanded((v) => !v)} className="flex w-full items-center justify-between px-4 py-3 text-left" aria-expanded={expanded}>
        <div>
          <p className="text-sm font-medium text-foreground">{plan.name}</p>
          <p className="text-xs text-muted-foreground">{plan.totalVolume.toLocaleString()} prospects · {intervalLabel}{plan.hasHubspot ? " · HubSpot enabled" : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="hidden items-center gap-1 sm:flex">
            {plan.personaMix.map((m) => (
              <span
                key={m.personaId}
                className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium"
                style={{ background: `${m.color ?? DEFAULT_PERSONA_COLOR}22`, color: m.color ?? DEFAULT_PERSONA_COLOR }}
              >
                {m.name} {m.targetPercent}%
              </span>
            ))}
          </div>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); void handleDelete(); }}
            aria-label={`Delete ${plan.name}`}
            className="rounded p-1 text-muted-foreground/60 hover:bg-muted hover:text-destructive"
          >
            <IconTrash size={14} />
          </button>
        </div>
      </button>
      {expanded && (
        <div className="border-t border-border px-4">
          <PlanProgress planId={plan.id} />
        </div>
      )}
    </div>
  );
}

export default function PullPlansRoute() {
  const [showNewPlan, setShowNewPlan] = useState(false);
  const { data: plansData, isLoading, refetch } = useActionQuery("list-prospect-pull-plans", {});
  const { data: personasData } = useActionQuery("list-personas", {});

  const plans = ((plansData as { plans?: PullPlan[] } | undefined)?.plans ?? []);
  const personas = ((personasData as { personas?: PersonaOption[] } | undefined)?.personas ?? []);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="text-sm font-semibold text-foreground">Pull Plans</h1>
          <p className="text-xs text-muted-foreground">Set a volume and persona mix; it fills automatically every cycle from HubSpot, CommonRoom, and your captured LinkedIn leads.</p>
        </div>
        <Button onClick={() => setShowNewPlan(true)}>
          <IconPlus size={14} /> New Plan
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : plans.length === 0 ? (
          <EmptyState icon={IconGauge} text="No pull plans yet — create one to start an automatic daily mix." />
        ) : (
          <div className="flex flex-col gap-3">
            {plans.map((plan) => (
              <PlanCard key={plan.id} plan={plan} onDeleted={() => void refetch()} />
            ))}
          </div>
        )}
      </div>

      {showNewPlan && (
        <NewPullPlanPanel
          personas={personas}
          onClose={() => setShowNewPlan(false)}
          onCreated={() => { setShowNewPlan(false); void refetch(); }}
        />
      )}
    </div>
  );
}
