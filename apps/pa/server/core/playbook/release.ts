// The bundled seed release: compiled from playbook/*.yaml at build time. It is
// the first release imported into the database, and what the browser demo and
// tests run on. Runtime code reads the active release from the store (D44).
import compiled from "../../generated/playbook-release.json";
import { playbookReleaseSchema, type PlaybookRelease } from "./schema.js";

export const seedRelease: PlaybookRelease =
  playbookReleaseSchema.parse(compiled);
