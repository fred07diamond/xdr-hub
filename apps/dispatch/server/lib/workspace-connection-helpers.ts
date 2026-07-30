import { dispatchActions } from "@agent-native/dispatch/actions";

export type GrantApp = {
  id: string;
  label: string;
};

type WorkspaceApp = {
  id: string;
  name?: string;
  status?: "ready" | "pending";
  archived?: boolean;
};

export function uniqueStrings(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter(Boolean)),
  );
}

export function humanizeAppId(appId: string): string {
  return appId
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function listGrantApps(): Promise<GrantApp[]> {
  const listWorkspaceApps = dispatchActions["list-workspace-apps"];
  if (!listWorkspaceApps) return [{ id: "dispatch", label: "Dispatch" }];

  try {
    const apps = (await listWorkspaceApps.run({
      includeAgentCards: false,
      audience: "all",
    } as any)) as WorkspaceApp[];
    const grantApps = apps
      .filter((app) => !app.archived && app.status !== "pending")
      .map((app) => ({
        id: app.id,
        label: app.name || humanizeAppId(app.id),
      }));
    return grantApps.length > 0
      ? grantApps
      : [{ id: "dispatch", label: "Dispatch" }];
  } catch {
    return [{ id: "dispatch", label: "Dispatch" }];
  }
}
