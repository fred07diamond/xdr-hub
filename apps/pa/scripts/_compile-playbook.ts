import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import {
  compilePlaybook,
  serializeRelease,
} from "../server/core/playbook/compile.js";
import { RELEASE_ARTIFACT, readCompileInputs } from "./_playbook-sources.js";

const check = process.argv.includes("--check");
const release = compilePlaybook(readCompileInputs());
const next = serializeRelease(release);

let current: string | null = null;
try {
  current = readFileSync(RELEASE_ARTIFACT, "utf8");
} catch {
  current = null;
}

if (check) {
  if (current !== next) {
    console.error(
      "Playbook release artifact is stale. Run `pnpm playbook:compile` and commit the result.",
    );
    process.exit(1);
  }
  console.log(`Playbook release ${release.short_id} is current.`);
} else {
  mkdirSync(dirname(RELEASE_ARTIFACT), { recursive: true });
  writeFileSync(RELEASE_ARTIFACT, next);
  console.log(
    `Compiled release ${release.short_id}: ${release.entries.length} entries, ${release.pending_confirmation.length} pending confirmations.`,
  );
}
