// Production runs on Neon Postgres; PGlite is the same engine in process.
import { defineRepositorySuite } from "./repository-suite.js";

defineRepositorySuite("postgres");
