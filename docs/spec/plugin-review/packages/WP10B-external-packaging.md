# WP10B — External plugin packaging & loading (gated)

**Depends on:** WP10A, WP07B, WP09B · **Gate:** ✱C. Run this package **only if the user approves at Checkpoint C** (decision U3). Otherwise the supervisor marks every row `deferred: third-party launch not in scope (U3)`.
**Priority:** P3
**Review sources:** [README WP10](../../../reviews/plugin-architecture/README.md#wp10); [DX-02](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-02), [DX-14](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-14), [DX-16](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-16); [BUILD-01](../../../reviews/plugin-architecture/other-areas.md#build-01); [SEC-02](../../../reviews/plugin-architecture/other-areas.md#sec-02).

## Goal

Let an independently built plugin compile against published Rowbly artifacts, be explicitly authorized and installed, and run its CLI and TUI contributions, under the WP10A trust and compatibility policies.

## Owns

- `package.json`: `exports`, the build entries, and peer dependencies. Rowbly is published through `.github/workflows/release.yml`, so these entries ship with the next release. Do not cut a release, bump the version, or edit the release workflow; releasing is the user's call. Make sure `pnpm pack` contains every declared entry and dynamic chunk.
- `tsup.config.ts`: the API entry builds and declarations
- `src/plugin-api/**`: entry shaping
- `src/services/plugins/host.ts` and `src/main.ts`: the external registry source, authorization, and compatibility checks. These are coordinated through the supervisor, since they are WP06 files and WP06 has merged.
- new `test/external/**`: the fixture package and smoke test

## Deliverables

1. **BUILD-01 / DX-02.**
   - Supported subpath exports `rowbly/plugin`, `rowbly/plugin/tui`, and `rowbly/plugin/testing`, with generated declarations.
   - The shebang stays on the CLI entry only.
   - There is one copy of React contexts and error constructors between host and plugin. Decide on the peer dependency policy for React, Ink, Zod, and Commander.
   - Importing `rowbly/plugin` does not load the Ink or React runtime.
2. **The external registry.** Use one explicit source, separate from plugin settings: for example a local manifest of `{ id, module }`, resolved against a documented location, and validated for its exported definition and ID. Keep deterministic order. Missing packages, ID mismatches, incompatible APIs, and bad exports become per-plugin load reasons.
3. **Authorization (SEC-01 / WP10A).** Committed configuration alone never executes an unapproved module. Authorization is local and scoped.
4. **DX-14 / VER-01 implementation.** An `apiVersion` (or a validated peer range) is checked **before** `start`. `plugins list` and `plugins show` explain mismatches.
5. **SEC-02.** Test namespace and symlink containment for the file API under the W5 policy, using WP02B's `pathPolicy`. State that in-process JavaScript remains trusted.
6. **DX-16 (optional).** A `rowbly plugins scaffold <id> --dir <path>`, only after the tutorial and harness work. It must not overwrite existing files, must validate the ID and reserved names, and must not rewrite core registry or map files.

## Acceptance criteria

- [ ] In a clean consumer directory: install the packed artifacts, compile a plugin using only public imports, explicitly authorize and install it, enable it, and exercise one hook, one CLI command, and one lazy TUI contribution.
- [ ] Unsupported API versions fail before hooks run, with an actionable reason. Other plugins keep working.
- [ ] Older Rowbly does not overwrite future plugin data (WP10A policy test).
- [ ] An explicit migration, if any exists, is idempotent, reports its planned changes, preserves backups and recovery, and survives interrupted execution.
- [ ] The trust policy is visible before a third-party plugin is installed.

## Findings

5 rows. Record final statuses in [findings.md](../findings.md#wp10b).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [BUILD-01](../../../reviews/plugin-architecture/other-areas.md#build-01) | P3 / conditional | External milestone | Public Plugin API is not a distributable package entry | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [DX-02](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-02) | P3 | External milestone | There is no supported external SDK package or installed-plugin loader | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [DX-14](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-14) | P3 | External milestone | Independently shipped plugins need an explicit compatibility policy | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [DX-16](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-16) | Optional | Optional / bounded | A scaffold is convenient after a stable runnable example exists | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [SEC-02](../../../reviews/plugin-architecture/other-areas.md#sec-02) | P3 / conditional | Conditional / decision | Lexical Plugin filenames do not establish physical filesystem containment | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
