import { table, text, now } from "@agent-native/core/db/schema";

export const workspaceUserRoles = table("workspace_user_roles", {
  email: text("email").primaryKey(),
  role: text("role", { enum: ["xdr", "ae", "admin", "none"] }).notNull().default("none"),
  hubspotAccountId: text("hubspot_account_id"),
  updatedAt: text("updated_at").default(now()),
});

export const workspaceAppAccess = table("workspace_app_access", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  app: text("app", { enum: ["li-agent", "booking", "dispatch"] }).notNull(),
  grantedBy: text("granted_by"),
  grantedAt: text("granted_at").default(now()),
});
