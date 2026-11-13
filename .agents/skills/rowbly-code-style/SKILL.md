---
name: rowbly-code-style
description: >
  The code style of Rowbly TypeScript: top-level functions, immutable state, block statements,
  blank lines between groups and one concern for each file. Use this skill before you write or
  change TypeScript in src/, and when you move a folder to the strict style.
---

# Rowbly code style

This guide gives the code style of Rowbly. `src/services/factory-manager/` is the reference
implementation. Read it as an example of each rule.

Biome enforces part of the style. This guide also gives the rules that Biome cannot find.

## Scope

The strict style applies to the folders in the strict override of `biome.json`. The override is the
entry with the `biome-plugins/` plugins. Biome enforces the strict rules only in these folders.

- Write all new modules in the strict style.
- When you change a function outside a strict folder, use the style for that function.
- To move a folder to the strict style, follow "Move a folder to the strict style" below.

## Rules that Biome enforces

These rules are in the strict override of `biome.json`.

| Rule                                      | What it stops                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------- |
| `style/useBlockStatements`                | An `if`, `else`, `for` or `while` body without `{` and `}`.            |
| `style/noNestedTernary`                   | A conditional expression inside a conditional expression.              |
| `style/noParameterAssign`                 | An assignment to a parameter.                                          |
| `style/noIncrementDecrement`              | `++` and `--`.                                                         |
| `style/noUselessElse`                     | An `else` after a branch that returns or throws.                       |
| `style/useReadonlyClassProperties`        | A class property that does not change and is not `readonly`.           |
| `style/noExcessiveLinesPerFile`           | A file with more than 400 lines.                                       |
| `complexity/noExcessiveLinesPerFunction`  | A function with more than 60 lines.                                    |
| `complexity/noExcessiveCognitiveComplexity` | A function with too many branches and loops in it.                   |
| `performance/noDelete`                    | The `delete` operator.                                                 |
| `biome-plugins/no-nested-function.grit`   | A named function inside a function body.                               |
| `biome-plugins/no-let.grit`               | A `let` declaration.                                                   |
| `biome-plugins/no-member-assign.grit`     | An assignment to a property, for example `state.count = 1`.            |
| `biome-plugins/no-mutating-call.grit`     | `push`, `splice`, `sort`, `set`, `delete`, `add`, `clear` and similar. |

The plugins use GritQL. They find patterns in the syntax, not in the types. Thus
`no-mutating-call.grit` also finds `set` and `delete` on objects that are not a Map or a Set.

## Functions

- Put each function at the top level of its module.
- Give each step of a long function a name, and move the step into its own function.
- Make the body of a long function a short list of calls to these steps.
- Use a guard clause and an early `return` in place of a nested `if`.
- A callback argument can stay inline. Keep it to one expression, and call a named function from it.
- An object of methods can call top-level functions. Each method must be one expression.

Example from `supervisor-loop.ts`:

```ts
async function superviseOnce(manager: Manager, contract: string): Promise<void> {
  await reconcilePolicy(manager);
  await refreshSettings(manager);
  await clearProviderPauses(manager);
  await commitProject(manager);

  if (getState(manager).stopping) {
    return;
  }
  // …
}
```

## State and immutability

Do not change an object, an array, a Map or a Set after you create it. Make a new value.

- Use `const` for each binding. Compute a value that depends on a condition with a conditional
  expression or a helper function.
- Make a new object with spread: `{ ...result, problems }`.
- Make a new array with spread, `map`, `filter` or `slice`.
- Make a new Map with `withEntry`, `withoutEntry` or `withoutEntries` from `store.ts`.
- Make a new record without a key with `Object.fromEntries` and `filter`.
- Mark the fields of a state type `readonly`. Use `ReadonlyMap` and `readonly T[]`.

Some state must be shared by tasks that run at the same time. Put this state in a `Store`:

- Keep the fixed environment, for example `deps`, `paths` and `ctx`, out of the store.
- Give each function the environment as its first parameter, for example `manager: Manager`.
- Read the state with `getState(manager)`. Read it again after each `await`, because a different task
  can replace it.
- Change the state with `setState(manager, (state) => ({ … }))`. The function gives only the changed
  fields.
- Give a short-lived task its own `Store`, for example `WorkerRun` in `worker-launch.ts`.

A pure helper takes values, not the store. For example, `shouldSkipDigest(state, delivery)` takes the
state that the caller read.

A service from a different module can change a file or a different object. That is I/O, not a change of
an object in this module.

## Layout of a function

Put a blank line between groups of statements:

- Put the declarations at the top of the function.
- Put declarations that do related work in one group, for example all reads of the store.
- Declare a value later only when it depends on an earlier `await` or check.
- Put a blank line after a group of declarations.
- Put a blank line before and after each `if`, `for`, `while` and `try` block.
- Put a blank line before the last `return` of a function, if the function has more than one statement.

Example from `manager-status.ts`:

```ts
export async function scan(manager: Manager, maxActive = getState(manager).limit): Promise<ScanResult> {
  const stories = await searchStories({}, manager.ctx);
  const stages = await classifiedStages(manager);
  const state = await readFactoryState(manager.paths.root, manager.ctx);

  const policy = evaluateScan(state, { stories, stages, maxActive });
  const cancelled = (state.nativeCancelled ?? {}) as CancelledStories;
  const { holds } = getState(manager);

  const decisions = policy.decisions.map((decision) => { /* … */ });

  return { ...policy, decisions };
}
```

## Files

- Give each file one concern. Give it a name for that concern, for example `worker-launch.ts`.
- A module folder can have many files. Keep the entry file, for example `factory-manager.ts`, small.
- Put shared types and small shared helpers in a state file, for example `manager-state.ts`.
- Import other files of the module directly. Do not make an import cycle.
- Put the fields of a large type in groups, with a comment above each group.

## Comments

- Give an exported function a one-line JSDoc comment.
- Give a function a comment when its name does not tell why it exists or what its limits are.
- Write a comment about the reason, not about the syntax.

## Exceptions

A rule can have a necessary exception. For example, the `Store` must replace its own value.

1. Put the exception in one small function or class.
2. Add `// biome-ignore lint/plugin: <reason>` or `// biome-ignore lint/<group>/<rule>: <reason>`.
3. Write the reason in the comment.

Do not add an exception to make a large change easier.

## Move a folder to the strict style

1. Add the folder to the `includes` list of the strict override in `biome.json`.
2. Run `pnpm lint`.
3. Repair each problem with the rules in this guide.
4. Apply the rules that Biome cannot find: the layout of each function, the files and the comments.
5. Run `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build`.
6. Commit the folder in one commit, without other changes.

When all of `src/` uses the strict style, move the rules of the override to the global `linter`
settings.

## Add a rule

1. Look for a Biome rule first. Run `pnpm exec biome explain <rule>` to read about a rule.
2. If Biome has no rule, write a GritQL plugin in `biome-plugins/`.
3. Add the rule or the plugin to the strict override of `biome.json`.
4. Make a temporary file with a violation, and make sure that `pnpm lint` finds it.
5. Add the rule to the table in this guide.
