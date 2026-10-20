# Plugin trust model

This page says which Plugin code Rowbly runs, how much that code is trusted, and what must be true before Rowbly ever runs Plugin code that does not ship with it. It records [ADR-0020 §6](../agents/adr/0020-plugin-execution-and-data-contracts.md#6-trust-model). Nothing here describes a sandbox, because Rowbly has none. Versions and data formats are in [compatibility.md](compatibility.md).

## 1. Today: only Built-in Plugins, and they are trusted

- Rowbly runs only Built-in Plugins. They are compiled into the same bundle as core and listed in one static registry (ADR-0009).
- `rowbly.config.json` only turns Built-in Plugins on or off (ADR-0010). An enabled ID that this Rowbly does not have is reported as not loaded. Rowbly does not look for code for it anywhere. Cloning a Data Root, or enabling a Plugin in it, can never make Rowbly run code that is not part of the Rowbly installation.
- **Built-in Plugins are trusted code.** They run in the Rowbly process with the same authority as core. They are reviewed and released together with core.

## 2. What the safeguards are, and what they are not

Rowbly has several safeguards around Plugin code. Each one protects against *accidental* misuse by trusted code. None of them contains malicious code.

| Safeguard | What it does | What it does not do |
| --- | --- | --- |
| Architecture import tests (`test/architecture.test.ts`) | Keep repository code to the convention: a Plugin imports only the Plugin API and no Node built-in module. | Confine anything at run time. A computed `import()`, `require`, or a global such as `process` or `fetch` is not seen by a source check. |
| Capabilities (`PluginServices`, `PluginReadServices`, `files`, `editText`, `git`) | Give each stage only the services it is meant to use. | Stop code from reaching the file system, network, environment or child processes by other means. |
| Frozen snapshots and stage-bound writers (ADR-0020 §1) | Stop a hook from changing the plan except through validated writer methods, and stop a writer from being used after its stage. | Protect against code that is written to get around them. |
| Plugin file scopes and the symlink policy (ADR-0019 §10) | Keep `files` reads and writes inside `plugins/<id>/` and reject symlinks there. | Make the check race-proof, or stop code that uses `node:fs` directly. |
| Cooperative timeouts (the reaction deadline, ADR-0020 §4) | Let Rowbly stop *waiting* for a slow reaction and carry on. | Interrupt a synchronous loop or stop detached work. A promise timeout cannot do that. |

In-process JavaScript code can do anything the Rowbly process can do: read and write any file the person can, use the network, read environment variables and run programs. Rowbly never describes a Plugin as sandboxed, confined or isolated.

## 3. Before any external Plugin code runs

A loader for Plugin code that does not ship with Rowbly is not scheduled. If it is ever built, it must meet all of these requirements before its first release.

### 3.1 Local authorization, separate from enablement

- **Enablement is not trust.** `rowbly.config.json` is committed and shared. A person who clones a Data Root, or pulls a change that enables a Plugin, has not approved its code. Enabling a Plugin must never by itself cause its code to run.
- **Each package identity and version is approved locally.** Before Rowbly loads any code from an external package (even its entry point: importing a module runs it), the person on that machine approves that package's identity and exact version. A new version, or a package whose content no longer matches what was approved, needs a new approval.
- **The approval lives where a clone cannot bring it.** It is not in `rowbly.config.json` or in any other file under the Data Root that Git can carry. It is per person and per machine. This policy does not prescribe where it lives or what it is called. In particular it prescribes no `trustedPlugins` configuration key.
- **Not approved means not loaded.** An enabled but unapproved Plugin is reported as not loaded, with the reason and the command that approves it, the same way as any other Plugin that fails to load. Its data is kept.
- **Approval can be withdrawn.** Withdrawing it stops the Plugin from loading again. It deletes no data.
- **The policy is visible before installation.** The install or approve flow shows this page's summary: the Plugin will run with the person's full authority.

### 3.2 Choose one execution mode, and name it

- **Full trust (in-process).** An approved external Plugin runs in the Rowbly process like a Built-in Plugin. This is a valid, simple choice. Rowbly then labels it *full trust* everywhere it appears (approval prompt, `plugins list`, `plugins show`, docs) and says it is not sandboxed.
- **Constrained (untrusted) execution** is a separate design, not part of this effort. It needs a process boundary (a separate process for Plugin code) and an audited capability protocol that states, per stage, which reads, writes, process and editor authority the Plugin has. It must stop access through other Plugins' contexts as well as through Node. JavaScript object wrappers and import checks are not such a boundary, and Rowbly never claims they are.

### 3.3 Tests when scheduled

- Cloning a Data Root that enables an unapproved package, and running any command or the TUI, does not evaluate the package's code (a fixture package that writes a sentinel file on import leaves no sentinel).
- An approved package loads. A changed version or changed content of the same package does not load until it is approved again.
- Approval made on one machine or Data Root does not carry over through a Git clone.
- Full-trust Plugins are labelled full trust in every listing.
- A constrained mode, if built, is tested against its stated threat model, including access through other Plugins' contexts and through Node built-ins.

## 4. What is not built

- No external loader, package discovery or install command.
- No approval list or other record of local authorization.
- No sandbox, worker or process boundary, and no permission UI.
