---
name: upgrade-agent-native
description: >-
  Bring an older Agent Native app or workspace current. Use when updating
  @agent-native/core, fixing a broken upgrade, or when tempted to patch or
  override core/dispatch packages to make an old branch run.
scope: dev
metadata:
  internal: true
---

# Upgrade Agent Native

## Rule

When an older Agent Native app/branch needs to run on current packages, use
`agent-native upgrade`. Don't "fix" upgrade breakage caused by an old app
being incompatible with current packages using `pnpm.overrides`,
`patchedDependencies`, `resolutions`, local patches, or edits under
`node_modules/@agent-native/*` — that class of problem is an app-level
incompatibility and the fix belongs in app code, not a framework patch.

**Exception:** a version-pinned `patchedDependencies` entry against
`@agent-native/core` (or `@agent-native/dispatch`) is allowed when the break
is a confirmed bug in the framework's own currently-resolved version, not app
code incompatible with it — e.g. a floating `"latest"` dependency silently
resolved to a version with a real server-side or client-side defect, verified
by reading that exact version's published source. Requirements when doing
this:

- Verify against the actual installed/resolved version's source before
  writing the patch — don't guess from docs or a different version.
- Patch the exact resolved version only (`pnpm patch <pkg>@<exact-version>`,
  producing a version-pinned `patchedDependencies` key), never the unpinned
  package name, so it can't silently apply to or block a different version
  elsewhere in the workspace.
- Pin that package's `package.json` specifier to the exact patched version
  (not `"latest"`) so the fix can't be silently dropped by a future install
  re-resolving `latest`.
- Keep the patch minimal and scoped to the one confirmed defect, with a
  comment in the diff explaining the bug and why app code can't work around
  it.
- Treat it as temporary: note in the patch/commit that it should be removed
  once the fix ships upstream, and re-check with `agent-native upgrade check`
  before the next real framework upgrade.

## Why

Agents often respond to a failed core bump by inventing framework patches and
dispatch behavior overrides to paper over app code that hasn't caught up with
a real upstream change. That hides the real app-level break, drifts from
upstream, and makes the next upgrade worse. For that case, the supported path
is bump → install → refresh scaffold skills → verify, then fix **app** code
only. The exception above is for the opposite situation — the framework
itself regressed — where patching app code can't fix a server-side defect.

## How

1. **Preview migration codemods first**

   ```bash
   npx @agent-native/core@latest upgrade --codemods
   ```

   Codemods are preview-by-default: read the diff before applying it. Do not
   manually edit imports before running this command; the migration manifest is
   the source of truth for renamed specifiers and symbols.

2. **Apply the reviewed codemods, then run the upgrade**

   ```bash
   npx @agent-native/core@latest upgrade --codemods --yes
   npx @agent-native/core@latest upgrade
   ```

   Or from an already-installed CLI: `pnpm exec agent-native upgrade` /
   `agent-native upgrade`.

   What it does:

   - Blocks (unless `--force`) when `@agent-native/*` overrides/patches exist
   - Rewrites non-local `@agent-native/*` dependency pins to `latest`
   - Runs the package manager install
   - Runs `skills update scaffold --project`
   - Runs `typecheck` when the project has that script

3. **Pull upstream template changes (optional, separate from the bump)**

   `agent-native upgrade` moves package versions. It never touches files that
   were copied out of a template at scaffold time, so template fixes and
   improvements do not arrive with a bump.

   ```bash
   agent-native template status        # recorded ref vs latest, drift counts
   agent-native template diff          # what upstream changed, read-only
   agent-native template sync          # 3-way merge it into the app
   ```

   `sync` defaults to the ref matching the installed `@agent-native/core`, so
   run it after `upgrade`. It merges per file against a pristine baseline
   stored in `refs/agent-native/template-baseline/<app-path>`; files upstream
   did not touch are left alone, and real collisions get conflict markers.
   After resolving markers, run `agent-native template accept` — the baseline
   deliberately does not advance past an unresolved merge.

   Apps scaffolded before provenance existed have no baseline. Create one
   with `agent-native template baseline` before the first sync.

4. **If upgrade or typecheck fails**

   - Read the concrete error
   - Fix **app** source, actions, config, or env — not framework packages
   - Re-run `agent-native upgrade` or `pnpm typecheck`
   - Stop and ask the user if you cannot fix the app-level error

   Intentional app-level UI customization is a separate workflow. Read
   `customizing-agent-native` when the product needs to own a selectively
   copied component; do not use that path to reproduce framework runtime
   behavior or hide version skew.

5. **Dry-run / partial runs**

   ```bash
   agent-native upgrade --dry-run
   agent-native upgrade --skip-verify
   agent-native upgrade --skip-install   # package.json bumps only
   agent-native doctor --only migration-manifest
   ```

   `migration-manifest` has no opt-out. Run it in CI before upgrading to find
   imports that will break, then use `npx @agent-native/core@latest upgrade --codemods`
   to preview the supported rewrite.

## Don't

- Don't add `pnpm.overrides`, `overrides`, `resolutions`, or an *unpinned*
  `patchedDependencies` entry for any `@agent-native/*` package
- Don't patch a framework package to route around app code that just hasn't
  caught up with a real upstream change — fix the app code instead
- Don't invent local "dispatch behavior" shims to paper over version skew
- Don't keep iterating with more framework patches after a failed install —
  if `agent-native upgrade` fails, that's an app-level break; fix app code
- Don't skip `skills update scaffold --project` after a core bump (the
  upgrade command does this for you)
- Don't leave a framework patch unpinned to a specific version, and don't
  forget to note it should be removed once fixed upstream

## Related Skills

- **self-modifying-code** — Tier 4: framework packages are off limits
- **agent-native-docs** — version-matched docs after the bump
- **customizing-agent-native** — intentional app-owned UI copies, not upgrade patches
- **portability** — keep app code provider-agnostic across upgrades
