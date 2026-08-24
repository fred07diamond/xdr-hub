import { useActionMutation, useActionQuery } from "@agent-native/core/client/hooks";
import { IconLoader2, IconShield } from "@tabler/icons-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export function meta() {
  return [{ title: "Admin — XDR Booking Agent" }];
}

interface User {
  email: string;
  role: string;
  hubspotAccountId: string | null;
  updatedAt: string | null;
}

interface CurrentUser {
  email: string;
  role: string;
}

const ROLES = ["xdr", "ae", "admin", "none"] as const;
type Role = (typeof ROLES)[number];

export default function AdminRoute() {
  const { data: currentUserData, isLoading: isLoadingMe } =
    useActionQuery("get-current-user", {});
  const currentUser = (currentUserData as any) as CurrentUser | undefined;
  const isAdmin = currentUser?.role === "admin";

  const { data, isLoading: isLoadingUsers, refetch } =
    useActionQuery("list-users", {}, { enabled: isAdmin });
  const users = ((data as any)?.users ?? []) as User[];

  const setRole = useActionMutation("set-user-role");

  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRole, setInviteRole] = useState<Role>("xdr");
  const [saving, setSaving] = useState<string | null>(null);
  const [rowFeedback, setRowFeedback] = useState<
    Record<string, { ok: boolean; msg: string }>
  >({});

  async function handleSetRole(email: string, role: Role) {
    setSaving(email);
    setRowFeedback((prev) => {
      const next = { ...prev };
      delete next[email];
      return next;
    });
    try {
      await setRole.mutateAsync({ email, role });
      setRowFeedback((prev) => ({
        ...prev,
        [email]: { ok: true, msg: "Saved" },
      }));
      await refetch();
    } catch (err: unknown) {
      const msg =
        err instanceof Error ? err.message : "Failed to update role";
      setRowFeedback((prev) => ({
        ...prev,
        [email]: { ok: false, msg },
      }));
    } finally {
      setSaving(null);
    }
  }

  async function handleAddUser() {
    const email = inviteEmail.trim();
    if (!email) return;
    await handleSetRole(email, inviteRole);
    setInviteEmail("");
  }

  // Loading state while we check the current user's role
  if (isLoadingMe) {
    return (
      <div className="flex h-full items-center justify-center">
        <IconLoader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // Access denied for non-admins
  if (!isAdmin) {
    return (
      <div className="flex h-full w-full items-center justify-center p-8">
        <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 shadow-lg text-center">
          <h1 className="mb-2 text-lg font-semibold">Access Denied</h1>
          <p className="text-sm text-muted-foreground">
            This page is restricted to administrators. Contact{" "}
            <a
              href="mailto:fred@builder.io"
              className="text-primary hover:underline"
            >
              fred@builder.io
            </a>{" "}
            to request access.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div className="flex items-center gap-2">
        <IconShield className="h-5 w-5 text-muted-foreground" />
        <h1 className="text-xl font-semibold">User Management</h1>
      </div>

      {/* Add / update a user */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Add / Update User</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input
            type="email"
            placeholder="user@builder.io"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            className="flex-1"
            disabled={saving !== null}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleAddUser();
            }}
          />
          <select
            value={inviteRole}
            onChange={(e) => setInviteRole(e.target.value as Role)}
            className="rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          >
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          <Button
            onClick={() => void handleAddUser()}
            disabled={!inviteEmail.trim() || saving !== null}
          >
            {saving === inviteEmail.trim() ? (
              <IconLoader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Save"
            )}
          </Button>
        </CardContent>
      </Card>

      {/* User list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Users</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoadingUsers ? (
            <div className="flex justify-center py-4">
              <IconLoader2 className="h-4 w-4 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <p className="text-sm text-muted-foreground">No users yet.</p>
          ) : (
            <div className="divide-y divide-border">
              {users.map((u) => {
                const fb = rowFeedback[u.email];
                return (
                  <div
                    key={u.email}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">
                        {u.email}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {u.hubspotAccountId
                          ? `HubSpot: ${u.hubspotAccountId}`
                          : "No HubSpot account"}
                        {u.updatedAt
                          ? ` · Updated ${new Date(u.updatedAt).toLocaleDateString()}`
                          : ""}
                      </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {fb && (
                        <span
                          className={`text-xs ${fb.ok ? "text-green-600" : "text-destructive"}`}
                        >
                          {fb.msg}
                        </span>
                      )}
                      <select
                        value={u.role}
                        onChange={(e) =>
                          void handleSetRole(u.email, e.target.value as Role)
                        }
                        disabled={saving === u.email}
                        className="rounded-md border border-input bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                      >
                        {ROLES.map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                      {saving === u.email && (
                        <IconLoader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
