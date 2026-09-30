// PA-local playbook roles (D44), shared by the server guard and the Team page.
// One role per person. The app owner (the workspace admin) holds neither and
// can do everything, including assigning these roles.

const descriptor = {
  appId: "pa",
  roles: ["pa_team", "revops"] as const,
  roleLabels: { pa_team: "PA team", revops: "RevOps" },
  label: "Playbook role",
};

export const PLAYBOOK_ROLES = descriptor;

export type PlaybookRole = (typeof descriptor.roles)[number];

export const TEAM_LABELS: Record<PlaybookRole, string> =
  PLAYBOOK_ROLES.roleLabels;
