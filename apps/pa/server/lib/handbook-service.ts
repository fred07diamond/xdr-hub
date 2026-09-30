// Who may edit the Sales handbook (D53), and error mapping for its actions.
import { fail, type ActionRunContext } from "@agent-native/core/action";

import { HandbookError } from "../core/handbook/index.js";
import { newId, now, repo } from "./pa-context.js";
import { teamDirectory } from "./pa-roles.js";

export const handbookDeps = () => ({ repo: repo(), now, newId });

/** The app owner and anyone holding a PA role (PA team or RevOps). */
export async function canEditHandbook(
  ctx: ActionRunContext | undefined,
): Promise<boolean> {
  const email = ctx?.userEmail?.toLowerCase();
  if (!email) return false;
  const directory = teamDirectory(ctx);
  const [owner, team] = await Promise.all([
    directory.isAppOwner(email),
    directory.teamOf(email),
  ]);
  return owner || team !== null;
}

/** Editing is a person's action from the page or the CLI, never the agent's. */
export async function requireHandbookEditor(
  ctx: ActionRunContext | undefined,
): Promise<string> {
  const email = ctx?.userEmail?.toLowerCase();
  if (!email) fail("Sign in to edit the handbook", { statusCode: 401 });
  if (ctx?.caller !== "frontend" && ctx?.caller !== "cli")
    fail("Only people edit the handbook", { statusCode: 403 });
  if (!(await canEditHandbook(ctx)))
    fail(
      "Editing the handbook needs a PA role (PA team or RevOps) or app owner access. Ask the app owner to assign one on the Team page.",
      { statusCode: 403 },
    );
  return email;
}

export async function handbookOrFail<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof HandbookError)
      fail(error.message, { statusCode: error.statusCode });
    throw error;
  }
}
