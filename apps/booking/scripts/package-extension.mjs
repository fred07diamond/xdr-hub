// Packages the Nooks Capture Chrome extension into a zip ready for either:
//   - manual sharing with teammates (unzip over their local unpacked copy), or
//   - upload to the Chrome Web Store Developer Dashboard
//
// Only includes the files manifest.json actually references (plus panel.js /
// options.js, which are loaded via <script> tags inside panel.html /
// options.html rather than the manifest) — dev-only scratch files like
// gen-icons.cjs are intentionally left out.
//
// Usage: pnpm package-extension
// Remember to bump "version" in extension/manifest.json first if this
// package is going to the Chrome Web Store — it rejects a re-upload with an
// unchanged version number.

import { execSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const extensionDir = path.resolve(__dirname, "../extension");
const outputZip = path.join(extensionDir, "nooks-capture-extension.zip");

const manifest = JSON.parse(readFileSync(path.join(extensionDir, "manifest.json"), "utf8"));

const FILES = [
  "manifest.json",
  manifest.background.service_worker,
  ...manifest.content_scripts.flatMap((cs) => cs.js),
  manifest.side_panel.default_path,
  "panel.js", // loaded via <script> inside panel.html, not in the manifest
  manifest.options_ui.page,
  "options.js", // loaded via <script> inside options.html, not in the manifest
  ...Object.values(manifest.icons),
];

const staging = mkdtempSync(path.join(tmpdir(), "nooks-capture-package-"));
try {
  for (const file of FILES) {
    const src = path.join(extensionDir, file);
    if (!existsSync(src)) throw new Error(`Expected extension file not found: ${file}`);
    copyFileSync(src, path.join(staging, file));
  }

  rmSync(outputZip, { force: true });
  execSync(`zip -r ${JSON.stringify(outputZip)} . -x ".*"`, { cwd: staging, stdio: "inherit" });

  console.log(`\nPackaged v${manifest.version} -> ${path.relative(process.cwd(), outputZip)}`);
  console.log("Files included:", FILES.join(", "));
} finally {
  rmSync(staging, { recursive: true, force: true });
}
