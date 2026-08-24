import { useActionMutation, useActionQuery, useSession } from "@agent-native/core/client/hooks";
import { DispatchShell } from "@agent-native/dispatch/components";
import { Badge } from "@agent-native/dispatch/components/ui/badge";
import { Button } from "@agent-native/dispatch/components/ui/button";
import { Checkbox } from "@agent-native/dispatch/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@agent-native/dispatch/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@agent-native/dispatch/components/ui/select";
import { Input } from "@agent-native/dispatch/components/ui/input";
import { TeamPage } from "@agent-native/core/client/org";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

export function meta() {
  return [{ title: "Team & Access — XDR Hub" }];
}

const APPS = [
  { id: "li-agent", label: "LinkedIn Agent" },
  { id: "booking", label: "XDR Booking" },
] as const;

type AppId = "li-agent" | "booking" | "dispatch";
type Role = "xdr" | "ae" | "admin" | "none";

interface WorkspaceMember {
  email: string;
  role: Role;
  hubspotAccountId: string | null;
  apps: AppId[];
}

function AppAccessRow({ member, onUpdate }: {
  member: WorkspaceMember;
  onUpdate: (email: string, patch: { grantApps?: AppId[]; revokeApps?: AppId[]; role?: Role }) => void;
}) {
  const hasApp = (app: AppId) => member.apps.includes(app);

  function toggleApp(app: AppId) {
    if (hasApp(app)) {
      onUpdate(member.email, { revokeApps: [app] });
    } else {
      onUpdate(member.email, { grantApps: [app] });
    }
  }

  return (
    <div className="flex items-center gap-4 rounded-lg border px-4 py-3">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">{member.email}</span>
      <Select
        value={member.role}
        onValueChange={(v) => onUpdate(member.email, { role: v as Role })}
      >
        <SelectTrigger className="w-36">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Workspace Admin</SelectItem>
          <SelectItem value="ae">AE</SelectItem>
          <SelectItem value="xdr">XDR</SelectItem>
          <SelectItem value="none">None</SelectItem>
        </SelectContent>
      </Select>
      {APPS.map(({ id, label }) => (
        <label key={id} className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Checkbox
            checked={hasApp(id)}
            onCheckedChange={() => toggleApp(id)}
          />
          {label}
        </label>
      ))}
    </div>
  );
}

export default function WorkspaceAccessRoute() {
  const qc = useQueryClient();
  const { session } = useSession();
  const teamQuery = useActionQuery<{ users: WorkspaceMember[] }>("list-workspace-team", {});
  const updateMember = useActionMutation("update-workspace-member");
  const [saving, setSaving] = useState<string | null>(null);
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<Role>("xdr");

  async function handleAddMember() {
    const email = newEmail.trim().toLowerCase();
    if (!email.includes("@")) {
      toast.error("Enter a valid email address");
      return;
    }
    setSaving(email);
    try {
      await updateMember.mutateAsync({
        email,
        role: newRole,
        grantApps: ["li-agent", "booking"],
      });
      await qc.invalidateQueries({ queryKey: ["action", "list-workspace-team"] });
      setNewEmail("");
      toast.success(`Added ${email} as ${newRole}`);
    } catch {
      toast.error("Failed to add member — try again");
    } finally {
      setSaving(null);
    }
  }

  async function handleUpdate(
    email: string,
    patch: { grantApps?: AppId[]; revokeApps?: AppId[]; role?: Role },
  ) {
    setSaving(email);
    try {
      await updateMember.mutateAsync({ email, ...patch });
      await qc.invalidateQueries({ queryKey: ["action", "list-workspace-team"] });
      toast.success("Saved");
    } catch {
      toast.error("Failed to save — try again");
    } finally {
      setSaving(null);
    }
  }

  return (
    <DispatchShell title="Team & Access">
      <div className="mx-auto w-full max-w-3xl space-y-8 px-4 py-8">
        <div>
          <h1 className="text-xl font-semibold">Team &amp; Access</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Invite team members and control which apps each person can access.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Signed in as{" "}
            <span className="font-medium text-foreground">
              {session?.email ?? "unknown — not signed in"}
            </span>
            . Whether the card below loads depends on this account's
            Workspace Role, not the org role in the card underneath it.
          </p>
        </div>

        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-base">Workspace Role &amp; App Access</CardTitle>
            <CardDescription>
              This is what actually controls access to admin-only features like
              Analytics, and which apps (LinkedIn Agent, Booking) someone can
              open at all. It's separate from the org "Admin"/"Member" role
              below, which only controls inviting people and org settings — a
              person can be an org Admin below with no Workspace Admin access
              here, or the reverse. Only an existing Workspace Admin (or the
              workspace owner) can change this.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {teamQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {teamQuery.isError && (
              <p className="text-sm text-destructive">
                Could not load team:{" "}
                {teamQuery.error instanceof Error ? teamQuery.error.message : String(teamQuery.error)}
              </p>
            )}
            {teamQuery.data?.users?.length === 0 && (
              <p className="mb-3 text-sm text-muted-foreground">
                No members have roles yet. Add yourself and your teammates
                below — new members get access to both apps by default.
              </p>
            )}
            {teamQuery.data && (
              <div className="mb-4 flex items-center gap-2">
                <Input
                  type="email"
                  placeholder="teammate@builder.io"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleAddMember()}
                  className="max-w-xs"
                />
                <Select value={newRole} onValueChange={(v) => setNewRole(v as Role)}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="admin">Workspace Admin</SelectItem>
                    <SelectItem value="ae">AE</SelectItem>
                    <SelectItem value="xdr">XDR</SelectItem>
                  </SelectContent>
                </Select>
                <Button size="sm" onClick={handleAddMember} disabled={!newEmail.trim()}>
                  Add member
                </Button>
              </div>
            )}
            <div className="space-y-2">
              {(teamQuery.data?.users ?? []).map((member) => (
                <div key={member.email} className="relative">
                  {saving === member.email && (
                    <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-background/60">
                      <span className="text-xs text-muted-foreground">Saving…</span>
                    </div>
                  )}
                  <AppAccessRow member={member} onUpdate={handleUpdate} />
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite &amp; Org Members</CardTitle>
            <CardDescription>
              Invite colleagues via email and manage org-level "Admin"/"Member"
              status (invites, org settings, deleting the org). This does
              <em> not</em> grant access to any app or admin feature — use the
              Workspace Role &amp; App Access card above for that.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TeamPage showTitle={false} />
          </CardContent>
        </Card>

        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Badge variant="outline">li-agent</Badge>
          LinkedIn Agent&nbsp;&nbsp;
          <Badge variant="outline">booking</Badge>
          XDR Booking
        </div>
      </div>
    </DispatchShell>
  );
}
