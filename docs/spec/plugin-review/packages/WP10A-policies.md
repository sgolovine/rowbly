# WP10A — Compatibility, trust & extension policies

**Depends on:** WP04B, WP02C · **Gate:** ✱B · **Wave:** 5 · **Priority:** P3 policy (documentation now; implementation is conditional)
**Review sources:** [README WP10](../../../reviews/plugin-architecture/README.md#wp10); [ARCH-27](../../../reviews/plugin-architecture/general-architecture.md#arch-27); [VER-01](../../../reviews/plugin-architecture/other-areas.md#ver-01); [SEC-01](../../../reviews/plugin-architecture/other-areas.md#sec-01); [GIT-01](../../../reviews/plugin-architecture/other-areas.md#git-01); [DEP-01](../../../reviews/plugin-architecture/other-areas.md#dep-01).

## Goal

Write the policies that must exist before anyone promises external plugins, Git automation, or plugin dependencies. Build no loader, sandbox, Git capability, or dependency graph.

## Owns

- new `docs/plugins/COMPATIBILITY.md`: the data-format and API policy
- new `docs/plugins/TRUST.md`: the trust model
- new `docs/adr/0021-plugin-format-and-compatibility-policy.md`, if the policy warrants an ADR
- `docs/adr/0016-git-automation-design.md`: a status note only

## Deliverables

1. **ARCH-27 (and the VER-02 migration part).**
   - Plugins own their bag and file formats. Unknown and disabled data stays opaque.
   - Existing unversioned built-in bags are legacy v1.
   - An incompatible new shape keeps recognizing the old shape until an explicit doctor fix or plugin migration command migrates it without loss.
   - Migration is **never** inferred from `readBag` returning `undefined`. It is never automatic at startup. It uses the coordinator and the transaction engine. It is dry-run-capable and idempotent.
   - JSON plugin files may carry their own version; Markdown need not.
   - Include a worked old/new bag example and the test requirements for a first real migration. Do not build a migration engine.
2. **VER-01.** The current API is internal and unreleased, coordinated with the host release. Before external packages: choose an API major version or range, validate it before activation, and report the required and actual versions. Distinguish the API version, the package version, and the storage version. No semver-range engine until ranges are needed.
3. **SEC-01 (D8).**
   - Built-ins are trusted.
   - An external loader requires local authorization of new package identities and versions, independent of committed enablement: cloning or enabling must never silently execute unapproved code.
   - A full-trust external mode is a valid choice, but it must be labeled full-trust.
   - Constrained or untrusted execution needs a process boundary and an audited capability protocol. That is a separate project.
   - No `trustedPlugins` key is prescribed.
4. **GIT-01.** Keep ADR-0016 marked planned. Record its missing capabilities and acceptance requirements in a status note:
   - repository resolution from the Data Root;
   - structured, argv-based Git with bounds;
   - reading local preferences;
   - `core.hooksPath` install and chaining;
   - hook args and stdin;
   - loop suppression;
   - overlap ordering.

   Implement none of it.
5. **DEP-01.** Defer until a plugin requires another one. Record the future requirements:
   - required versus optional dependencies;
   - versions;
   - missing and cycle behavior;
   - failure propagation, including TUI import failure;
   - stable topological order that preserves registry order;
   - interaction with clash winners.

## Acceptance criteria

- [ ] The policy documents exist and are linked from `docs/PLUGINS.md`. Send that link change to WP09B as a Docs handoff if WP09B has merged, or ask the supervisor.
- [ ] The compatibility policy includes a worked old/new bag example and states that older Rowbly does not overwrite future plugin data.
- [ ] The trust policy is accurate and makes no sandbox claim.
- [ ] Each conditional finding without implementation is marked `deferred: <condition>`, for example "until an external loader / Git plugin / dependent plugin is scheduled".

## Findings

5 rows. Record final statuses in [findings.md](../findings.md#wp10a).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-27](../../../reviews/plugin-architecture/general-architecture.md#arch-27) | Optional | Optional / bounded | Persisted plugin format evolution needs a stated policy | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DEP-01](../../../reviews/plugin-architecture/other-areas.md#dep-01) | P3 / conditional | Conditional / decision | Dependency semantics are not implemented, but current registry can evolve | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [GIT-01](../../../reviews/plugin-architecture/other-areas.md#git-01) | P3 / conditional | Conditional / decision | ADR-0016 needs narrowly scoped host capabilities | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [SEC-01](../../../reviews/plugin-architecture/other-areas.md#sec-01) | P3 / conditional | External milestone | Architectural import restrictions do not confine runtime code | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [VER-01](../../../reviews/plugin-architecture/other-areas.md#ver-01) | P3 / conditional | External milestone | No explicit Plugin API compatibility/version policy | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
