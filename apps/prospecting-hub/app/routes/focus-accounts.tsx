import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
  IconArrowLeft,
  IconCheck,
  IconCloudDownload,
  IconFlag3,
  IconLoader2,
  IconPlus,
  IconTrash,
  IconX,
} from "@tabler/icons-react";
import { useState } from "react";

import { APP_TITLE } from "@/lib/app-config";

export function meta() {
  return [{ title: `${APP_TITLE} — Focus Accounts` }];
}

// ── Types ────────────────────────────────────────────────────────────────────

interface FocusAccount {
  id: string;
  companyName: string;
  companyDomain: string | null;
  tier: string | null;
  ownerEmail: string;
  createdAt: string | null;
}

interface HubSpotOwnerOption {
  id: string;
  name: string;
}

type MatchedVia = "companyOwner" | "xdrOwner" | "both";

interface HubSpotOwnedCompany {
  id: string;
  name: string;
  domain: string | null;
  matchedVia: MatchedVia;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function errorMessage(err: unknown, fallback: string) {
  return err instanceof Error && err.message ? err.message : fallback;
}

// ── New focus account panel ──────────────────────────────────────────────────

function NewFocusAccountPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const createFocusAccount = useActionMutation("create-focus-account");

  const [companyName, setCompanyName] = useState("");
  const [companyDomain, setCompanyDomain] = useState("");
  const [tier, setTier] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function handleCreate() {
    setError(null);
    if (!companyName.trim()) return;
    try {
      await createFocusAccount.mutateAsync({
        companyName: companyName.trim(),
        companyDomain: companyDomain.trim() || undefined,
        tier: tier.trim() || undefined,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(errorMessage(err, "Couldn't create focus account."));
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 className="text-sm font-semibold text-foreground">New focus account</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Company name</label>
            <input
              autoFocus
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="e.g. Acme Inc"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Domain (optional)</label>
            <input
              value={companyDomain}
              onChange={(e) => setCompanyDomain(e.target.value)}
              placeholder="acme.com"
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div>
            <label className="mb-1.5 block text-xs font-medium text-muted-foreground">Tier (optional)</label>
            <input
              value={tier}
              onChange={(e) => setTier(e.target.value)}
              placeholder="e.g. 1"
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
            onClick={handleCreate}
            disabled={!companyName.trim() || createFocusAccount.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {createFocusAccount.isPending && <IconLoader2 size={12} className="animate-spin" />}
            Add account
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Matched-via badge ────────────────────────────────────────────────────────

function MatchedViaBadge({ matchedVia }: { matchedVia: MatchedVia }) {
  const label =
    matchedVia === "both" ? "Both" : matchedVia === "xdrOwner" ? "xDR Owner" : "Company Owner";
  const colorClasses =
    matchedVia === "both"
      ? "bg-green-500/10 text-green-600 dark:text-green-400"
      : matchedVia === "xdrOwner"
        ? "bg-violet-500/10 text-violet-600 dark:text-violet-400"
        : "bg-sky-500/10 text-sky-600 dark:text-sky-400";
  return (
    <span className={`inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${colorClasses}`}>
      {label}
    </span>
  );
}

// ── Add from HubSpot panel ───────────────────────────────────────────────────

// Two-step bulk-import flow: (1) pick a real HubSpot owner — an XDR's
// accounts are usually filed under either HubSpot's native "Company owner"
// (typically the AE) or the custom "xDR Owner" property, so the picker is
// owner-agnostic and the browse step shows which field(s) matched — then
// (2) browse and checklist-select that owner's companies, bulk-creating the
// checked ones as Focus Accounts in one call.
function AddFromHubSpotPanel({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { data: ownersData, isLoading: ownersLoading } = useActionQuery(
    "search-hubspot-company-owners",
    {},
  );
  const owners: HubSpotOwnerOption[] = (ownersData as { owners?: HubSpotOwnerOption[] } | undefined)?.owners ?? [];

  const [ownerQuery, setOwnerQuery] = useState("");
  const [showOwnerSuggestions, setShowOwnerSuggestions] = useState(false);
  const [selectedOwner, setSelectedOwner] = useState<HubSpotOwnerOption | null>(null);
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<Set<string>>(new Set());
  const [result, setResult] = useState<{ created: number; skipped: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    data: companiesData,
    isLoading: companiesLoading,
    error: companiesError,
  } = useActionQuery(
    "search-hubspot-companies-by-owner",
    { ownerId: selectedOwner?.id ?? "" },
    { enabled: !!selectedOwner },
  );
  const companies: HubSpotOwnedCompany[] =
    (companiesData as { companies?: HubSpotOwnedCompany[] } | undefined)?.companies ?? [];

  const bulkCreate = useActionMutation("bulk-create-focus-accounts");

  const filteredOwners = owners.filter((o) =>
    o.name.toLowerCase().includes(ownerQuery.trim().toLowerCase()),
  );

  function pickOwner(owner: HubSpotOwnerOption) {
    setSelectedOwner(owner);
    setOwnerQuery(owner.name);
    setShowOwnerSuggestions(false);
    setSelectedCompanyIds(new Set());
    setResult(null);
    setError(null);
  }

  function backToOwnerPick() {
    setSelectedOwner(null);
    setOwnerQuery("");
    setSelectedCompanyIds(new Set());
    setResult(null);
    setError(null);
  }

  function toggleCompany(id: string) {
    setSelectedCompanyIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    setSelectedCompanyIds((prev) =>
      prev.size === companies.length ? new Set() : new Set(companies.map((c) => c.id)),
    );
  }

  async function handleConfirm() {
    setError(null);
    const chosen = companies.filter((c) => selectedCompanyIds.has(c.id));
    if (!chosen.length) return;
    try {
      const res = (await bulkCreate.mutateAsync({
        accounts: chosen.map((c) => ({ companyName: c.name, companyDomain: c.domain ?? undefined })),
      })) as { created: number; skipped: number };
      setResult(res);
      setSelectedCompanyIds(new Set());
      onCreated();
    } catch (err) {
      setError(errorMessage(err, "Couldn't add focus accounts."));
    }
  }

  const allSelected = companies.length > 0 && selectedCompanyIds.size === companies.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-2xl bg-card border border-border shadow-2xl">
        <div className="flex items-center gap-2 border-b border-border px-5 py-4">
          {selectedOwner && (
            <button type="button" onClick={backToOwnerPick} className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Back">
              <IconArrowLeft size={16} />
            </button>
          )}
          <h2 className="flex-1 text-sm font-semibold text-foreground">Add from HubSpot</h2>
          <button type="button" onClick={onClose} className="rounded p-1 text-muted-foreground hover:bg-muted">
            <IconX size={16} />
          </button>
        </div>

        <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto p-5">
          {!selectedOwner ? (
            <div>
              <label className="mb-1.5 block text-xs font-medium text-muted-foreground">
                Pick an owner (Company owner or xDR Owner)
              </label>
              {ownersLoading ? (
                <div className="flex h-9 items-center text-xs text-muted-foreground">
                  <IconLoader2 size={13} className="mr-1.5 animate-spin" /> Loading HubSpot owners…
                </div>
              ) : owners.length === 0 ? (
                <p className="text-xs text-muted-foreground/60">
                  HubSpot isn't connected, so there are no owners to browse. Connect HubSpot to bulk-add
                  focus accounts this way, or add accounts manually.
                </p>
              ) : (
                <div className="relative">
                  <input
                    autoFocus
                    value={ownerQuery}
                    onChange={(e) => {
                      setOwnerQuery(e.target.value);
                      setShowOwnerSuggestions(true);
                    }}
                    onFocus={() => setShowOwnerSuggestions(true)}
                    onBlur={() => setTimeout(() => setShowOwnerSuggestions(false), 150)}
                    placeholder="Search HubSpot owners…"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-2 focus:ring-ring"
                  />
                  {showOwnerSuggestions && filteredOwners.length > 0 && (
                    <div className="absolute z-10 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-border bg-popover shadow-lg">
                      {filteredOwners.map((owner) => (
                        <button
                          key={owner.id}
                          type="button"
                          onMouseDown={(e) => {
                            e.preventDefault();
                            pickOwner(owner);
                          }}
                          className="flex w-full items-center px-3 py-1.5 text-left text-xs text-foreground hover:bg-muted"
                        >
                          {owner.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : result ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border py-8 text-center">
              <span className="flex size-9 items-center justify-center rounded-full bg-green-500/10 text-green-600 dark:text-green-400">
                <IconCheck size={18} />
              </span>
              <div>
                <p className="text-sm font-medium text-foreground">
                  Added {result.created} focus account{result.created === 1 ? "" : "s"}
                </p>
                {result.skipped > 0 && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    Skipped {result.skipped} already on your list
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={backToOwnerPick}
                className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted"
              >
                Add more from another owner
              </button>
            </div>
          ) : (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs text-muted-foreground">
                  Browsing <span className="font-medium text-foreground">{selectedOwner.name}</span>'s companies
                </p>
                {companies.length > 0 && (
                  <button
                    type="button"
                    onClick={toggleSelectAll}
                    className="text-[11px] font-medium text-primary hover:underline"
                  >
                    {allSelected ? "Deselect all" : "Select all"}
                  </button>
                )}
              </div>

              {companiesLoading ? (
                <div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
                  <IconLoader2 size={16} className="mr-1.5 animate-spin" /> Loading companies…
                </div>
              ) : companiesError ? (
                <p className="text-xs text-destructive">
                  {errorMessage(companiesError, "Couldn't load companies for this owner.")}
                </p>
              ) : companies.length === 0 ? (
                <div className="flex h-24 flex-col items-center justify-center gap-1 text-center">
                  <p className="text-xs font-medium text-muted-foreground">
                    {selectedOwner.name} has no companies in HubSpot
                  </p>
                  <p className="text-[11px] text-muted-foreground/60">
                    Try a different owner, or add accounts manually.
                  </p>
                </div>
              ) : (
                <div className="flex max-h-64 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
                  {companies.map((c) => (
                    <label
                      key={c.id}
                      className="flex items-center gap-2 rounded px-1.5 py-1.5 text-xs text-foreground hover:bg-muted/50"
                    >
                      <input
                        type="checkbox"
                        checked={selectedCompanyIds.has(c.id)}
                        onChange={() => toggleCompany(c.id)}
                        className="size-3.5 shrink-0 rounded border-border"
                      />
                      <span className="min-w-0 flex-1 truncate" title={c.name}>
                        {c.name}
                        {c.domain && <span className="ml-1.5 text-muted-foreground/60">{c.domain}</span>}
                      </span>
                      <MatchedViaBadge matchedVia={c.matchedVia} />
                    </label>
                  ))}
                </div>
              )}

              {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
            </div>
          )}
        </div>

        {selectedOwner && !result && companies.length > 0 && (
          <div className="flex items-center justify-between border-t border-border px-5 py-4">
            <p className="text-[11px] text-muted-foreground">
              {selectedCompanyIds.size} selected
            </p>
            <div className="flex gap-2">
              <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs font-medium text-muted-foreground hover:bg-muted">
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirm}
                disabled={selectedCompanyIds.size === 0 || bulkCreate.isPending}
                className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
              >
                {bulkCreate.isPending && <IconLoader2 size={12} className="animate-spin" />}
                Add {selectedCompanyIds.size || ""} focus account{selectedCompanyIds.size === 1 ? "" : "s"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Row ───────────────────────────────────────────────────────────────────────

function FocusAccountRow({
  account,
  onRefetch,
}: {
  account: FocusAccount;
  onRefetch: () => void;
}) {
  const deleteFocusAccount = useActionMutation("delete-focus-account");
  const [confirmDelete, setConfirmDelete] = useState(false);

  async function handleDelete() {
    try {
      const result = await deleteFocusAccount.mutateAsync({ id: account.id });
      if ((result as { ok?: boolean; error?: string })?.ok === false) {
        alert((result as { error: string }).error);
        setConfirmDelete(false);
        return;
      }
      onRefetch();
    } catch (err) {
      alert(errorMessage(err, "Couldn't delete focus account."));
      setConfirmDelete(false);
    }
  }

  return (
    <tr className="border-b border-border/60 align-top">
      <td className="max-w-[240px] px-4 py-3">
        <p className="truncate text-sm font-medium text-foreground" title={account.companyName}>
          {account.companyName}
        </p>
      </td>
      <td className="px-4 py-3 text-xs text-muted-foreground">
        {account.companyDomain || <span className="text-muted-foreground/40">—</span>}
      </td>
      <td className="px-4 py-3">
        {account.tier ? (
          <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground">
            Tier {account.tier}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground/40">—</span>
        )}
      </td>
      <td className="px-4 py-3 text-right">
        {confirmDelete ? (
          <div className="flex items-center justify-end gap-1">
            <button
              type="button"
              onClick={handleDelete}
              disabled={deleteFocusAccount.isPending}
              className="rounded-md px-2 py-1 text-xs font-medium text-destructive transition-colors hover:bg-destructive/10"
            >
              {deleteFocusAccount.isPending ? "Deleting…" : "Confirm"}
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
            aria-label="Delete focus account"
            title="Delete focus account"
          >
            <IconTrash size={14} />
          </button>
        )}
      </td>
    </tr>
  );
}

// ── Route ────────────────────────────────────────────────────────────────────

export default function FocusAccountsRoute() {
  const { data, isLoading, refetch } = useActionQuery("list-focus-accounts", {}, {
    refetchInterval: 30000,
    staleTime: 25000,
  });
  const accounts: FocusAccount[] = (data as { focusAccounts?: FocusAccount[] })?.focusAccounts ?? [];

  const [creating, setCreating] = useState(false);
  const [addingFromHubSpot, setAddingFromHubSpot] = useState(false);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h1 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <IconFlag3 size={15} className="text-muted-foreground" />
            Focus Accounts
          </h1>
          <p className="text-xs text-muted-foreground">
            Target companies to scope your CommonRoom Prospector searches
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setAddingFromHubSpot(true)}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted"
          >
            <IconCloudDownload size={13} />
            Add from HubSpot
          </button>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            <IconPlus size={13} />
            Add account
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        {isLoading ? (
          <div className="flex h-32 items-center justify-center">
            <IconLoader2 size={20} className="animate-spin text-muted-foreground" />
          </div>
        ) : accounts.length === 0 ? (
          <div
            className="mx-4 mt-4 flex h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border text-center transition-colors hover:border-border/60 hover:bg-muted/20"
            onClick={() => setCreating(true)}
          >
            <IconFlag3 size={32} className="text-muted-foreground/30" />
            <div>
              <p className="text-sm font-medium text-muted-foreground">No focus accounts yet</p>
              <p className="mt-1 text-xs text-muted-foreground/60">
                Add the companies you want to target
              </p>
            </div>
          </div>
        ) : (
          <table className="w-full text-left text-xs">
            <thead className="sticky top-0 border-b border-border bg-background text-muted-foreground">
              <tr>
                <th className="px-4 py-2 font-medium">Company</th>
                <th className="px-4 py-2 font-medium">Domain</th>
                <th className="px-4 py-2 font-medium">Tier</th>
                <th className="px-4 py-2 font-medium" />
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <FocusAccountRow key={account.id} account={account} onRefetch={refetch} />
              ))}
            </tbody>
          </table>
        )}
      </div>

      {creating && (
        <NewFocusAccountPanel onClose={() => setCreating(false)} onCreated={refetch} />
      )}
      {addingFromHubSpot && (
        <AddFromHubSpotPanel onClose={() => setAddingFromHubSpot(false)} onCreated={refetch} />
      )}
    </div>
  );
}
