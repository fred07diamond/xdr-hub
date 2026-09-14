import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import {
  IconAlertTriangle,
  IconCheck,
  IconCoins,
  IconLoader2,
  IconUsers,
} from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

// Admin surfaces for Apollo credit governance.
//
// Two cards, deliberately separate: the workspace budget and policy knobs are
// settings you change rarely and think about once, while the per-user
// allocation table is an operational tool you come back to when someone runs
// out. Merging them would bury the kill switch under a member table.

const VERDICT_BARS = [
  { value: "strong", label: "Strong only" },
  { value: "strong_or_possible", label: "Strong or Possible" },
  { value: "not_weak", label: "Anything but Weak" },
  { value: "any", label: "Any lead" },
] as const;

interface CreditSettings {
  enabled: boolean;
  periodBudget: number;
  anchorDay: number;
  safetyMargin: number;
  userDefaultLimit: number;
  phoneStopPct: number;
  sweepReservePct: number;
  thresholds: number[];
  enrichMinVerdict: string;
  phoneMinVerdict: string;
  periodStart: string;
  resetLabel: string;
}

interface UsageData {
  enabled?: boolean;
  spent?: number;
  budget?: number;
  remaining?: number;
  spentPct?: number;
  resetLabel?: string;
  emailCredits?: number;
  phoneCredits?: number;
  phoneCalls?: number;
  emailCalls?: number;
  overrideCount?: number;
}

function num(v: string, fallback: number): number {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
}

export function ApolloCreditsCard() {
  const { data, isLoading } = useActionQuery("get-apollo-credit-settings", {});
  const { data: usageRaw } = useActionQuery("get-apollo-credit-usage", {});
  const settings = data as CreditSettings | undefined;
  const usage = usageRaw as UsageData | undefined;
  const save = useActionMutation("set-apollo-credit-settings");

  // Local form state, seeded from the server once it arrives. Kept as strings
  // so a half-typed number does not get clamped out from under the cursor.
  const [budget, setBudget] = useState("");
  const [anchorDay, setAnchorDay] = useState("");
  const [userDefault, setUserDefault] = useState("");
  const [phoneStop, setPhoneStop] = useState("");
  const [sweepReserve, setSweepReserve] = useState("");
  const [margin, setMargin] = useState("");
  const [enrichBar, setEnrichBar] = useState("");
  const [phoneBar, setPhoneBar] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [saved, setSaved] = useState(false);
  const [confirmToggle, setConfirmToggle] = useState<null | boolean>(null);

  useEffect(() => {
    if (!settings || seeded) return;
    setBudget(String(settings.periodBudget));
    setAnchorDay(String(settings.anchorDay));
    setUserDefault(String(settings.userDefaultLimit));
    setPhoneStop(String(settings.phoneStopPct));
    setSweepReserve(String(settings.sweepReservePct));
    setMargin(String(settings.safetyMargin));
    setEnrichBar(settings.enrichMinVerdict);
    setPhoneBar(settings.phoneMinVerdict);
    setSeeded(true);
  }, [settings, seeded]);

  const dirty = useMemo(() => {
    if (!settings) return false;
    return (
      num(budget, settings.periodBudget) !== settings.periodBudget ||
      num(anchorDay, settings.anchorDay) !== settings.anchorDay ||
      num(userDefault, settings.userDefaultLimit) !== settings.userDefaultLimit ||
      num(phoneStop, settings.phoneStopPct) !== settings.phoneStopPct ||
      num(sweepReserve, settings.sweepReservePct) !== settings.sweepReservePct ||
      num(margin, settings.safetyMargin) !== settings.safetyMargin ||
      enrichBar !== settings.enrichMinVerdict ||
      phoneBar !== settings.phoneMinVerdict
    );
  }, [settings, budget, anchorDay, userDefault, phoneStop, sweepReserve, margin, enrichBar, phoneBar]);

  async function handleSavePolicy() {
    if (!settings) return;
    await save.mutateAsync({
      periodBudget: num(budget, settings.periodBudget),
      anchorDay: num(anchorDay, settings.anchorDay),
      userDefaultLimit: num(userDefault, settings.userDefaultLimit),
      phoneStopPct: num(phoneStop, settings.phoneStopPct),
      sweepReservePct: num(sweepReserve, settings.sweepReservePct),
      safetyMargin: num(margin, settings.safetyMargin),
      enrichMinVerdict: enrichBar,
      phoneMinVerdict: phoneBar,
    });
    setSeeded(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  async function handleConfirmToggle() {
    const next = confirmToggle;
    setConfirmToggle(null);
    if (next == null) return;
    await save.mutateAsync({ enabled: next });
    setSeeded(false);
  }

  const spent = usage?.spent ?? 0;
  const budgetNow = usage?.budget ?? settings?.periodBudget ?? 0;
  const pct = budgetNow > 0 ? Math.min(100, (spent / budgetNow) * 100) : 0;

  return (
    <Card id="apollo-credits" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconCoins size={16} />
          Apollo Credits
        </CardTitle>
        <CardDescription>
          Apollo charges <span className="font-semibold text-foreground">1 credit</span> for an email and{" "}
          <span className="font-semibold text-foreground">8</span> for a phone reveal. This workspace is one of three
          tools sharing the account, so the budget below is this app&rsquo;s own share, not Apollo&rsquo;s balance.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 size={14} className="animate-spin" /> Loading credit settings…
          </p>
        )}

        {settings && (
          <>
            {/* The kill switch, first and visually distinct: the thing an admin
                comes to this card in a hurry to find. */}
            <div
              className={`rounded-lg border p-3 ${
                settings.enabled
                  ? "border-emerald-300 bg-emerald-50 dark:border-emerald-900 dark:bg-emerald-950/30"
                  : "border-border bg-muted/40"
              }`}
            >
              {confirmToggle != null ? (
                <div className="space-y-2">
                  <p className="text-sm text-foreground">
                    {confirmToggle
                      ? "Turn Apollo enrichment on? This lets the workspace start spending shared credits."
                      : "Turn Apollo enrichment off? Every enrichment and phone reveal stops immediately, for everyone."}
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={handleConfirmToggle}
                      disabled={save.isPending}
                      className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50 ${
                        confirmToggle ? "bg-emerald-600 hover:bg-emerald-700" : "bg-destructive hover:bg-destructive/90"
                      }`}
                    >
                      {save.isPending ? <IconLoader2 size={13} className="animate-spin" /> : null}
                      {confirmToggle ? "Turn enrichment on" : "Turn enrichment off"}
                    </button>
                    <button
                      type="button"
                      onClick={() => setConfirmToggle(null)}
                      className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-muted"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      Enrichment is {settings.enabled ? "on" : "off"}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {settings.enabled
                        ? `${spent.toLocaleString()} of ${budgetNow.toLocaleString()} credits used · resets ${settings.resetLabel}`
                        : "No Apollo calls are being made by any user or the background sweep."}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setConfirmToggle(!settings.enabled)}
                    className="shrink-0 rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium hover:bg-muted"
                  >
                    {settings.enabled ? "Turn off" : "Turn on"}
                  </button>
                </div>
              )}
            </div>

            {/* Spend meter with the phone-pause point marked, so the two
                numbers below are read as positions on the same bar. */}
            {budgetNow > 0 && (
              <div className="space-y-1.5">
                <div className="relative h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full ${pct >= 100 ? "bg-destructive" : pct >= settings.phoneStopPct ? "bg-amber-500" : "bg-emerald-500"}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <div className="relative h-3">
                  <div
                    className="absolute top-0 -translate-x-1/2 text-[10px] text-muted-foreground"
                    style={{ left: `${Math.min(96, settings.phoneStopPct)}%` }}
                  >
                    ▲ phones pause
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {(usage?.remaining ?? Math.max(0, budgetNow - spent)).toLocaleString()} credits left ·{" "}
                  {(usage?.emailCredits ?? 0).toLocaleString()} on emails,{" "}
                  {(usage?.phoneCredits ?? 0).toLocaleString()} on {usage?.phoneCalls ?? 0} phone reveals
                </p>
              </div>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <NumberField
                label="Credits per period"
                hint="This app's share of the Apollo account."
                value={budget}
                onChange={setBudget}
                min={0}
              />
              <NumberField
                label="Renews on day"
                hint="Day of the month, UTC. Max 28 so every month has it."
                value={anchorDay}
                onChange={setAnchorDay}
                min={1}
                max={28}
              />
              <NumberField
                label="Default per-user limit"
                hint="Applies to anyone with no explicit allowance below."
                value={userDefault}
                onChange={setUserDefault}
                min={0}
              />
              <NumberField
                label="Pause phone reveals at %"
                hint="Emails keep working past this point."
                value={phoneStop}
                onChange={setPhoneStop}
                min={1}
                max={100}
              />
              <NumberField
                label="Max % for the background sweep"
                hint="Reserves the rest for work people do by hand."
                value={sweepReserve}
                onChange={setSweepReserve}
                min={0}
                max={100}
              />
              <NumberField
                label="Safety margin"
                hint="Credits held back to absorb simultaneous requests."
                value={margin}
                onChange={setMargin}
                min={0}
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Auto-enrich leads scored"
                value={enrichBar}
                onChange={setEnrichBar}
              />
              <SelectField
                label="Reveal phones for leads scored"
                value={phoneBar}
                onChange={setPhoneBar}
              />
            </div>

            {/* The inconclusive trap, spelled out rather than discovered. */}
            {(enrichBar === "strong" || enrichBar === "strong_or_possible") && (
              <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Leads score <strong>Inconclusive</strong> when no ICP document is uploaded. With this bar, a workspace
                  without an ICP would auto-enrich nothing at all. &ldquo;Anything but Weak&rdquo; is the safe default.
                </span>
              </p>
            )}

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSavePolicy}
                disabled={save.isPending || !dirty}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {save.isPending ? <IconLoader2 size={13} className="animate-spin" /> : saved ? <IconCheck size={13} /> : null}
                {saved ? "Saved!" : "Save credit settings"}
              </button>
              {dirty && !save.isPending && (
                <span className="text-xs text-muted-foreground">Unsaved changes</span>
              )}
            </div>
            {save.isError && (
              <p className="text-xs text-destructive">{(save.error as Error)?.message ?? "Failed to save"}</p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

function NumberField({
  label,
  hint,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      />
      {hint && <p className="text-[11px] leading-4 text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SelectField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full rounded-md border border-border bg-background px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-ring"
      >
        {VERDICT_BARS.map((b) => (
          <option key={b.value} value={b.value}>
            {b.label}
          </option>
        ))}
      </select>
    </div>
  );
}

// ---------------------------------------------------------------------------

interface UserLimitRow {
  userEmail: string;
  role: string;
  explicitLimit: number | null;
  effectiveLimit: number;
  spent: number;
  remaining: number;
  calls: number;
}

interface UserLimitsData {
  resetLabel?: string;
  workspaceBudget?: number;
  workspaceSpent?: number;
  userDefaultLimit?: number;
  rows?: UserLimitRow[];
  totalAllocated?: number;
  overAllocated?: boolean;
}

export function ApolloUserLimitsCard() {
  const { data, isLoading, refetch } = useActionQuery("get-apollo-user-limits", {});
  const d = data as UserLimitsData | undefined;
  const setLimit = useActionMutation("set-apollo-user-limit");

  // Which row is being edited, and the in-progress text. Only one at a time:
  // a table of live inputs invites saving the wrong row.
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  async function commit(email: string) {
    const trimmed = draft.trim();
    // Empty CLEARS the override so the user re-inherits the workspace default,
    // rather than pinning them to today's value.
    const value = trimmed === "" ? null : Number.parseInt(trimmed, 10);
    if (value != null && (!Number.isFinite(value) || value < 0)) return;
    await setLimit.mutateAsync({ userEmail: email, creditLimit: value });
    setEditing(null);
    setDraft("");
    await refetch();
  }

  const rows = d?.rows ?? [];

  return (
    <Card id="apollo-user-limits" className="scroll-mt-16">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <IconUsers size={16} />
          Per-User Credit Limits
        </CardTitle>
        <CardDescription>
          Each person gets their own ceiling on Apollo credits per period, so one bulk run cannot drain the shared
          pool. Leave a limit blank to inherit the workspace default
          {d?.userDefaultLimit != null ? ` (${d.userDefaultLimit.toLocaleString()})` : ""}.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading && (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <IconLoader2 size={14} className="animate-spin" /> Loading members…
          </p>
        )}

        {!isLoading && rows.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No workspace members with roles yet. Assign roles on the Team tab, then set their limits here.
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 pr-3 font-medium">User</th>
                  <th className="pb-2 pr-3 font-medium">Role</th>
                  <th className="pb-2 pr-3 text-right font-medium">Spent</th>
                  <th className="pb-2 pr-3 font-medium">Limit</th>
                  <th className="pb-2 text-right font-medium">Left</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const atLimit = r.remaining === 0 && r.effectiveLimit > 0;
                  return (
                    <tr key={r.userEmail} className="border-b border-border/50 last:border-0">
                      <td className="py-2 pr-3 align-middle">
                        <span className="font-medium text-foreground">{r.userEmail.split("@")[0]}</span>
                        <span className="text-muted-foreground">@{r.userEmail.split("@")[1] ?? ""}</span>
                      </td>
                      <td className="py-2 pr-3 align-middle text-xs text-muted-foreground">{r.role}</td>
                      <td className="py-2 pr-3 text-right align-middle tabular-nums">
                        <span className={atLimit ? "font-semibold text-destructive" : ""}>
                          {r.spent.toLocaleString()}
                        </span>
                        {r.calls > 0 && (
                          <span className="block text-[11px] text-muted-foreground">{r.calls} calls</span>
                        )}
                      </td>
                      <td className="py-2 pr-3 align-middle">
                        {editing === r.userEmail ? (
                          <span className="flex items-center gap-1">
                            <input
                              autoFocus
                              type="number"
                              min={0}
                              value={draft}
                              placeholder="default"
                              onChange={(e) => setDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") void commit(r.userEmail);
                                if (e.key === "Escape") setEditing(null);
                              }}
                              className="w-20 rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring"
                            />
                            <button
                              type="button"
                              onClick={() => void commit(r.userEmail)}
                              disabled={setLimit.isPending}
                              className="rounded-md bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
                            >
                              Save
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              setEditing(r.userEmail);
                              setDraft(r.explicitLimit == null ? "" : String(r.explicitLimit));
                            }}
                            className="rounded-md border border-dashed border-border px-2 py-1 text-xs hover:bg-muted"
                          >
                            {r.explicitLimit == null ? (
                              <span className="text-muted-foreground">
                                default ({r.effectiveLimit.toLocaleString()})
                              </span>
                            ) : (
                              <span className="font-medium tabular-nums">{r.explicitLimit.toLocaleString()}</span>
                            )}
                          </button>
                        )}
                      </td>
                      <td className="py-2 text-right align-middle tabular-nums text-muted-foreground">
                        {r.remaining.toLocaleString()}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {d?.overAllocated && (
          <p className="flex gap-2 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            <IconAlertTriangle size={14} className="mt-0.5 shrink-0" />
            <span>
              Per-user limits add up to {d.totalAllocated?.toLocaleString()}, more than the workspace budget of{" "}
              {d.workspaceBudget?.toLocaleString()}. That is allowed — they are independent ceilings, not an
              allocation — but the workspace limit will stop everyone before individual limits are reached.
            </span>
          </p>
        )}

        {rows.length > 0 && (
          <p className="text-xs text-muted-foreground">
            {(d?.workspaceSpent ?? 0).toLocaleString()} of {(d?.workspaceBudget ?? 0).toLocaleString()} workspace
            credits used · resets {d?.resetLabel ?? "—"}
          </p>
        )}

        {setLimit.isError && (
          <p className="text-xs text-destructive">{(setLimit.error as Error)?.message ?? "Failed to save"}</p>
        )}
      </CardContent>
    </Card>
  );
}
