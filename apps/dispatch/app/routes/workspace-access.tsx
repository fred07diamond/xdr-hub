import { useActionMutation, useActionQuery } from "@agent-native/core/client";
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
        <SelectTrigger className="w-28">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="admin">Admin</SelectItem>
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
  const teamQuery = useActionQuery<{ users: WorkspaceMember[] }>("list-workspace-team", {});
  const updateMember = useActionMutation("update-workspace-member");
  const [saving, setSaving] = useState<string | null>(null);

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
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Invite &amp; Org Members</CardTitle>
            <CardDescription>
              Invite colleagues via email. They'll receive a sign-in link to XDR Hub.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TeamPage showTitle={false} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">App Access &amp; Roles</CardTitle>
            <CardDescription>
              Set each member's XDR Hub role and which apps they can use.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {teamQuery.isLoading && (
              <p className="text-sm text-muted-foreground">Loading…</p>
            )}
            {teamQuery.isError && (
              <p className="text-sm text-destructive">
                Could not load team — admin access required.
              </p>
            )}
            {teamQuery.data?.users?.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No users found. Roles are populated once someone signs in or is
                bootstrapped.
              </p>
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
