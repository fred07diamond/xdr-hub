import { eq } from "drizzle-orm";

import { getDb } from "../../db/index.js";
import { apolloUserCreditLimits } from "../../db/schema.js";

// Per-user Apollo credit allowances, so one person can't drain the shared
// workspace pool.
//
// An ABSENT row means "inherit the workspace default". Storing the default
// value per user instead would mean a later change to the default silently
// skipped everyone who had already been listed -- which is exactly the kind of
// surprise an admin would not discover until someone was blocked.

/** The allowance for one user, resolving the default when no row exists. */
export async function getUserCreditLimit(userEmail: string, workspaceDefault: number): Promise<number> {
  const [row] = await getDb()
    .select({ creditLimit: apolloUserCreditLimits.creditLimit })
    .from(apolloUserCreditLimits)
    .where(eq(apolloUserCreditLimits.userEmail, userEmail.toLowerCase()))
    .limit(1);
  if (!row || row.creditLimit == null) return workspaceDefault;
  return Math.max(0, Number(row.creditLimit));
}

export interface UserCreditLimitRow {
  userEmail: string;
  /** Null means this user inherits the workspace default. */
  creditLimit: number | null;
  updatedAt: string | null;
}

/** Every explicitly-set allowance, for the admin allocation table. */
export async function listUserCreditLimits(): Promise<UserCreditLimitRow[]> {
  const rows = await getDb()
    .select({
      userEmail: apolloUserCreditLimits.userEmail,
      creditLimit: apolloUserCreditLimits.creditLimit,
      updatedAt: apolloUserCreditLimits.updatedAt,
    })
    .from(apolloUserCreditLimits);
  return rows.map((r) => ({
    userEmail: r.userEmail,
    creditLimit: r.creditLimit == null ? null : Number(r.creditLimit),
    updatedAt: r.updatedAt ?? null,
  }));
}

/**
 * Sets or clears one user's allowance. Passing null DELETES the row, so the
 * user goes back to inheriting the workspace default rather than being pinned
 * to whatever the default happened to be today.
 */
export async function setUserCreditLimit(userEmail: string, creditLimit: number | null): Promise<void> {
  const email = userEmail.trim().toLowerCase();
  if (!email) throw Object.assign(new Error("A user email is required."), { statusCode: 400 });
  const db = getDb();

  if (creditLimit == null) {
    await db.delete(apolloUserCreditLimits).where(eq(apolloUserCreditLimits.userEmail, email));
    return;
  }

  const value = Math.max(0, Math.trunc(creditLimit));
  const now = new Date().toISOString();
  await db
    .insert(apolloUserCreditLimits)
    .values({ userEmail: email, creditLimit: value, updatedAt: now })
    .onConflictDoUpdate({
      target: apolloUserCreditLimits.userEmail,
      set: { creditLimit: value, updatedAt: now },
    });
}
