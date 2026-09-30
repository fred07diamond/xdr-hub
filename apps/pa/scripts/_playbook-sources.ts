import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import type { CompileInput } from "../server/core/playbook/compile.js";

export const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
export const RELEASE_ARTIFACT = join(
  APP_ROOT,
  "server/generated/playbook-release.json",
);

function read(path: string) {
  return {
    path: relative(APP_ROOT, path).split("\\").join("/"),
    text: readFileSync(path, "utf8"),
  };
}

export function readCompileInputs(root = APP_ROOT): CompileInput {
  const playbookDir = join(root, "playbook");
  const playbooks = readdirSync(playbookDir)
    .filter((name) => name.endsWith(".yaml") || name.endsWith(".yml"))
    .sort()
    .map((name) => read(join(playbookDir, name)));
  return {
    playbooks,
    routingPool: read(join(root, "config/routing-pool.yaml")),
    hubspotMapping: read(join(root, "config/hubspot-mapping.yaml")),
  };
}
