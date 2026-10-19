# Rowbly documentation

Rowbly is a developer-focused, file-backed Kanban tracker for the terminal. The [project README](../README.md) is the user guide: install, commands, the TUI, doctor findings and exit codes. The pages below explain how Rowbly is built and how to extend it.

## Where to start

| You want to… | Read |
| --- | --- |
| Learn the words Rowbly uses | [Glossary](agents/CONTEXT.md) and the [context map](agents/CONTEXT-MAP.md) |
| Understand how the code is put together | [Architecture overview](architecture/overview.md) |
| Know what is stored where | [Data model](architecture/data-model.md) |
| Change how something is saved | [Operations](architecture/operations.md), then [Storage and commits](architecture/storage.md) |
| Write or change a Plugin | [Writing a Plugin](plugins/writing-a-plugin.md), then the [Plugin API reference](plugins/api.md) |
| Build, test or debug Rowbly | [Development](development/README.md) |
| Know why something is the way it is | [Architecture decisions](adr/README.md) |

## Contents

```text
docs/
  README.md                  this page
  agents/
    CONTEXT.md               the core glossary: the only names to use for core concepts
    CONTEXT-MAP.md           the glossaries of each Built-in Plugin, and how they relate to core
  architecture/
    overview.md              goals, surfaces, technology, source layers
    data-model.md            the Data Root, its records and files, the Configuration Cascade, doctor
    operations.md            the operation pipeline, and every operation with its input and result
    storage.md               the Data Root lock, the commit journal, recovery and its guarantees
  plugins/
    README.md                the plugin system: loading, settings, Plugin Data, names, surfaces, doctor
    built-in.md              the Built-in Plugins: Epics, Specs and Comments
    writing-a-plugin.md      tutorial: build a Plugin step by step
    api.md                   reference: every contract a Plugin can rely on
    compatibility.md         policy: API versions, data formats, migrations, dependencies
    trust.md                 policy: which Plugin code runs, and what the safeguards are not
  development/
    README.md                commands, tests, tracing and benchmarks
  adr/
    README.md                index of the architecture decision records
    0001-…0021-…             one decision per file
```

## Rules for these docs

- Use the terms in the glossaries exactly, and never their `_Avoid_` words.
- A page that tests read must keep its path and shape. Change the page and the test together:
  - [`architecture/operations.md`](architecture/operations.md): `test/plugins/operationInventory.test.ts` checks the operation tables against the code.
  - [`plugins/writing-a-plugin.md`](plugins/writing-a-plugin.md) and [`plugins/api.md`](plugins/api.md): `test/docs/tutorial.test.ts` requires each `ts`/`tsx` block to be a `// #region` of a compiled fixture under `test/docs/fixtures/`.
  - [`agents/CONTEXT-MAP.md`](agents/CONTEXT-MAP.md): `test/e2e/language.test.ts` requires a link to each Built-in Plugin's `CONTEXT.md`.
- An accepted ADR is a record. Do not rewrite its decision; add a new ADR that supersedes or amends it, and add a status line to the old one.
- Describe what is built. Mark anything planned as planned.
