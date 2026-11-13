---
name: rowbly-code-style
description: >
  The code style of Rowbly TypeScript: top-level functions, immutable state, block statements,
  blank lines between groups, one concern for each file, dash-case names and React components. Use
  this skill before you write or change TypeScript in src/.
---

# Rowbly code style

This guide gives the code style of Rowbly. `src/services/factory-manager/` is the reference
implementation. Read it as an example of each rule.

Biome enforces part of the style. This guide also gives the rules that Biome cannot find.

## Scope

The strict style applies to all non-test TypeScript in `src/`. The strict override of `biome.json` is
the entry with the `biome-plugins/` plugins. Its `includes` list is `src/**` without the test files.

- Write all code in `src/` in the strict style.
- Test files (`*.test.ts`, `*.test.tsx`) use only the recommended rules of Biome. Keep them clear,
  but the strict rules do not apply to them.

## Names

All files and folders use dash-case names: lower-case words with a `-` between them.

- A component file has the dash-case form of the component name. The `StoryRow` component is in
  `story-row/story-row.tsx`.
- Identifiers do not change. Components stay PascalCase. Functions, hooks and values stay camelCase.
- Extensions follow the first dot: `story-row.test.tsx`, `commit-project.d.mts`, `vitest.config.ts`.

`pnpm lint` checks the names. Biome `useFilenamingConvention` checks script files.
`scripts/check-names.mjs` checks each path that Git tracks, also folders, Markdown and HTML.

These names are exceptions. The script lists them.

- Meta files with upper-case names: `README.md`, `AGENTS.md`, `CLAUDE.md`, `SKILL.md`, `LICENSE.md`,
  `UPSTREAM.md` and `CHANGELOG.md`.
- Dotfiles and dotfolders, for example `.gitignore` and `.github/`. The name after the dot is dash-case.
- `.agents/skills/agentic-tui/`, because it is an unchanged upstream copy.
- `stages/*.md` and all of `.rowbly/`, because these names are stage keys and story IDs.

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
| `style/useFilenamingConvention`           | A script file name that is not dash-case. This rule applies to all files. |
| `complexity/noExcessiveLinesPerFunction`  | A function with more than 60 lines.                                    |
| `complexity/noExcessiveCognitiveComplexity` | A function with too many branches and loops in it.                   |
| `performance/noDelete`                    | The `delete` operator.                                                 |
| `biome-plugins/no-nested-function.grit`   | A named function inside a function body.                               |
| `biome-plugins/no-let.grit`               | A `let` declaration.                                                   |
| `biome-plugins/no-member-assign.grit`     | An assignment to a property, for example `state.count = 1`. A class constructor can set `this.<field>`. |
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
- Use `toSorted`, `toReversed` and `toSpliced`. The plugin finds `[...items].sort()` also.
- Make a new Map with `withEntry`, `withoutEntry` or `withoutEntries` from
  `src/services/store/store.ts`.
- Make a new Set with `withMember` or `withoutMember` from the same module.
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

## React components

The strict rules also apply to components and hooks in `src/tui/`. Use these patterns.

1. **Logic in top-level functions.** Put each handler and each step in a top-level function with
   explicit parameters. Collect the environment of a component in one typed object, `env`: the
   context, `toast`, the state setters, the refs and the callbacks from props.
2. **Handlers are one expression.** Write a handler as an inline callback argument that calls a
   top-level function. Use a JSX prop, `onClick={() => openThread(env, id)}`, or a hook argument,
   `useInput((input, key) => handleListKey(env, input, key), { isActive })`.
3. **Shared handlers in `actions`.** If two or more places use a handler, put it in a
   `const actions = { … }` object. Each method is one expression.
4. **Memoization does not change.** Do not add or remove `useCallback` or `useMemo` to satisfy a rule.
   Do not put `env` or `actions` in a dependency array.
5. **Stable listeners.** If a listener must keep one reference for on and off, get it from a top-level
   factory function, for example `const listener = mouseListener(registry)`.
6. **Effects.** A `useEffect` callback can have a short block body with the setup and a cleanup.
   Do not declare `const f = () => …` in it.
7. **Cancellation.** Use an `AbortController` for the cancellation flag of an effect, not `let`.
8. **Refs.** Write a ref only through `writeRef`, `useLatest` or `runExclusive` from
   `src/tui/hooks/refs.ts`.
9. **Registries.** A closure registry (mouse, shell, toasts) keeps its state in a `Store` with a
   `ReadonlyMap` or a `ReadonlySet`. A `useSyncExternalStore` snapshot must keep the same reference
   until the state changes.

A long or complex component gets smaller in these steps:

1. Move the derived values to pure top-level helpers.
2. Move the state and the handlers to a hook in the folder of the component.
3. Move a visual region to a sub-component. Give it its own folder, `index.ts`, test and barrel entry.

Do not write JSX "render functions" that a component calls as plain functions.

Before:

```tsx
export function ThreadList({ threads, onOpen }: Props) {
  const toast = useToast();
  const [cursor, setCursor] = useState(0);
  const open = () => {
    const thread = threads[cursor];
    if (!thread) return;
    onOpen(thread.id);
    toast.info(`Opened ${thread.id}`);
  };
  useInput((input, key) => {
    if (key.return) open();
    else setCursor((c) => c + moveDelta(input, key));
  }, { isActive: useIsActive() });
  // …
}
```

After:

```tsx
interface ThreadListEnv {
  readonly threads: readonly Thread[];
  readonly cursor: number;
  readonly setCursor: Dispatch<SetStateAction<number>>;
  readonly onOpen: (id: string) => void;
  readonly toast: Toasts;
}

function openThread(env: ThreadListEnv): void {
  const thread = env.threads[env.cursor];

  if (!thread) {
    return;
  }

  env.onOpen(thread.id);
  env.toast.info(`Opened ${thread.id}`);
}

function handleListKey(env: ThreadListEnv, input: string, key: Key): void {
  if (key.return) {
    openThread(env);

    return;
  }

  env.setCursor((cursor) => cursor + moveDelta(input, key));
}

export function ThreadList({ threads, onOpen }: Props) {
  const toast = useToast();
  const [cursor, setCursor] = useState(0);
  const isActive = useIsActive();

  const env: ThreadListEnv = { threads, cursor, setCursor, onOpen, toast };

  useInput((input, key) => handleListKey(env, input, key), { isActive });
  // …
}
```

## Exceptions

A rule can have a necessary exception. Each exception is in one small function or class:

- `Store` in `src/services/store/store.ts` replaces its own value.
- `writeRef` in `src/tui/hooks/refs.ts` writes a React ref.
- The scanner of the conversation session reads each byte of a large file. One
  `biome-ignore-start lint/plugin` and `biome-ignore-end lint/plugin` range covers this hot path.

To add an exception:

1. Put the exception in one small function or class.
2. Add `// biome-ignore lint/plugin: <reason>` or `// biome-ignore lint/<group>/<rule>: <reason>`.
3. Write the reason in the comment.

Do not add an exception to make a large change easier.

Do not copy a growing collection for each item of an input that has no limit. The time becomes
quadratic. Build the collection in one pass, for example with `map`, `filter`, `flatMap` or
`Object.fromEntries`.

## Add a rule

1. Look for a Biome rule first. Run `pnpm exec biome explain <rule>` to read about a rule.
2. If Biome has no rule, write a GritQL plugin in `biome-plugins/`.
3. Add the rule or the plugin to the strict override of `biome.json`. Add a rule that also applies to
   tests and config files to the global `linter` settings.
4. Make a temporary file with a violation, and make sure that `pnpm lint` finds it.
5. Add the rule to the table in this guide.
