import {
  useActionMutation,
  useActionQuery,
} from "@agent-native/core/client";
import {
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
        <button
          type="button"
          onClick={() => setCreating(true)}
          className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90"
        >
          <IconPlus size={13} />
          Add account
        </button>
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
    </div>
  );
}
