# WP04B — Plugin inputs, parsing & author API

**Depends on:** WP06, WP01B, WP05A · **Gate:** ✱B · **Wave:** 5 · **Priority:** P2 (DX-07 is P1 as an external milestone; optional items are evaluated)
**Review sources:** [README WP04](../../../reviews/plugin-architecture/README.md#wp04) (including its scope guard); [DX-07](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-07), [DX-11](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-11), [DX-12](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-12), [DX-30](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-30), [DX-33](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-33); [ARCH-02](../../../reviews/plugin-architecture/general-architecture.md#arch-02); [CQ-03](../../../reviews/plugin-architecture/code-quality.md#cq-03); the authoring-glue table in [straightforwardness §Repeated patterns](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#repeated-patterns-epics-specs-comments-and-the-fixture).

## Goal

Make authoring correct and checkable without growing the API needlessly (D9). The work:

- typed, schema-validated plugin inputs and filters, with per-operation schemas;
- one absent/clear/value convention across CLI and TUI;
- opt-in repeatable parsing;
- separate filter criteria from mutation input;
- narrowed Action types;
- an operation inventory;
- a deliberate export surface.

Evaluate the optional helpers last, against a re-measured example.

## Owns

- `src/services/plugins/types.ts`, `src/services/types.ts`, `src/plugin-api/**`
- `src/commands/_shared.ts`, `src/commands/stories.ts`: the parsing and input plumbing only (DX-11, DX-12, CQ-03, CQ-14)
- `src/tui/screens/stories/StoryFormScreen.tsx`: CQ-14's local helper only
- `src/services/plugins/runtime.ts`: input-schema validation before body and hooks only
- small shared helpers: `src/schemas/formatIssues.ts` (CQ-01), `src/core/*` (CQ-12, CQ-20, if selected)
- `test/architecture.test.ts`: ARCH-01's rule
- compile fixtures and new tests

## May touch

Built-in plugins and fixtures, to adopt the new input and filter schemas mechanically: Epics, Specs, Notes. This is a consumer change: per-plugin validation semantics stay as WP08 set them.

## Deliverables

1. **DX-07, typed inputs.**
   - Optional **per-operation** input schemas: `inputs?: Partial<Record<CoreOperationName, ZodType>>`, plus `storyFilterSchema?`.
   - Only supplied payloads are validated, before the body and hooks run. An invalid payload is an attributed `ValidationError` with issues, and nothing is saved.
   - Map payload issue paths to the TUI's prefixed `plugin:<id>:<name>` fields. Unrelated issues become form-level errors.
   - Filter parsing happens once per list invocation.
   - `unknown` stays the honest fallback for untyped cross-plugin operations.
   - Do not force one plugin-wide schema.
2. **DX-12.** Distinguish list `filter(values): F | undefined` from mutation `input(values): I | undefined`, as a discriminated mapped type. CLI and TUI produce the same filter schema. Any/all matching is unchanged.
3. **Absent, clear, and value (DX-11, CQ-03, CQ-14).**
   - Document and type the raw option values (`string | string[] | boolean | undefined`, keyed by Commander attribute, so `--add-spec` becomes `addSpec`).
   - Expose `parseRepeatable` as an **opt-in** capability for core-attached option input, and use it in Specs. Repeatable text with commas stays literal unless the plugin opts in.
   - Preserve the difference between `undefined` and explicitly empty.
   - CQ-14: use `pluginOptions(cmd)` directly in the Story list. Rename the form-local helper to `pluginInputOptions`.
   - Don't add `z.coerce` shorthands.
4. **DX-30.** A discriminated Action union. A Story action's `run` receives a required Story. The task and none variants reflect the real runtime guarantees. Keyboard and header dispatch validate the same way.
5. **ARCH-02.** Publish one operation inventory: each name, input, and result, for core and built-ins. Add recorder tests for the names and inputs every built-in emits. Validate local operation names as a nonempty single segment. Keep the current verbs (W1).
6. **Exports (DX-33, CQ-50, CQ-51, CQ-53, CQ-54).**
   - Add `PluginCommands` and `PluginOption` aliases (DX-23), and `export type { Command }` (CQ-50).
   - Export named types only where a public example or fixture needs them. Write an export inventory that records the deliberate omissions.
   - Make a deliberate decision on `useToast` (CQ-51).
   - Document the absent settings schema behavior (CQ-53, DX-35); keep raw passthrough and show `z.strictObject` for typo detection.
   - Keep or trim `ActivePlugin` and `LoadPluginsOptions` deliberately (CQ-54).
7. **Types hygiene:**
   - CQ-18 and ARCH-19: define `PluginFieldKind` and the value union once, with a compile-time assignability check against `FormField`. TUI may depend on service types; not the reverse.
   - CQ-17: explain `(string & {})`.
   - CQ-72: document the filter `UsageError`.
   - CQ-21: the `OperationInput` alias, documented or removed.
   - CQ-26: optional.
   - DX-06: withdrawn as a defect. Optionally add `= Record<string, unknown>` defaults to the standalone TUI types.
8. **ARCH-01.** Add an architecture rule that rejects runtime `react`, `ink`, or `commander` imports under `src/services`, while allowing type-only imports. Pipeline-only tests use a small explicit reserved-name fixture. Do **not** move the host or the types wholesale.
9. **ARCH-32.** Record the usage inventory. Wiring tests are already consolidated under ARCH-16 (WP06). Keep the fixture-tested capabilities.
10. **Optional; evaluate and record the decision:**
    - **DX-01:** only after (1–3). Re-measure the complete Points example from the [DX exercise](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#concrete-exercise-hello-world-and-a-realistic-story-field). Add `defineStoryFieldPlugin` only if it stays small and passes the parity matrix there.
    - **DX-22 / ARCH-12:** JSON file helpers only if a second consumer exists. They must preserve pending reads and data-integrity errors.
    - DX-23 `cli.action`; ARCH-31 (keep `cli.run`).
    - ARCH-10 `withoutPluginInput`; ARCH-20 timestamp helper.
    - CQ-01 `formatIssues`; CQ-07 core long-text helper; CQ-09 `settingsOf`; CQ-11; CQ-12 `ifFound`; CQ-13 `latestBoard`; CQ-20 `compareStrings` (code-unit order).
    - Withdrawn: ARCH-22, CQ-52, DX-34.

## Acceptance criteria

- [ ] A sample plugin compiles with no casts for settings or input. Invalid input rejects before any write with an attributed `VALIDATION` error and its issues, through the CLI, the TUI, and service calls. A thrown transform bug stays `INTERNAL` (DX-07).
- [ ] No input does nothing. Explicit `null` clears. A value sets it. This holds the same way on both surfaces. Repeatable and negative flags normalize predictably. A repeatable text option keeps literal commas unless it opts in (DX-11, CQ-03).
- [ ] The compiler distinguishes list criteria from mutation input (DX-12). A Story Action can use `focus.story.key` without optional chaining (DX-30).
- [ ] Recorder tests match the published operation inventory. A malformed local name fails before save (ARCH-02).
- [ ] CLI-only code imports no Ink or React runtime. The architecture test rejects an injected runtime UI import in services (ARCH-01).
- [ ] The compile fixtures cover the exports, aliases, and settings inference. A consumer fixture annotates commands, options, and statuses using only approved entries.
- [ ] Every optional finding has `done` or `deferred: <reason>`.

## Findings

39 rows. Record final statuses in [findings.md](../findings.md#wp04b).

| Finding | Priority | Disposition | Issue | Required outcome |
| --- | --- | --- | --- | --- |
| [ARCH-01](../../../reviews/plugin-architecture/general-architecture.md#arch-01) | Optional | Optional / bounded | The service-side contract includes CLI and TUI declarations | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-02](../../../reviews/plugin-architecture/general-architecture.md#arch-02) | Optional | Optional / bounded | Plugin operation names have no explicit implementation catalog | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-10](../../../reviews/plugin-architecture/general-architecture.md#arch-10) | Optional | Optional / bounded | Domain inputs contain plugin transport metadata | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-12](../../../reviews/plugin-architecture/general-architecture.md#arch-12) | Optional | Optional / bounded | Plugin JSON files repeat parsing/serialization and use input-validation errors for corrupt files | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-19](../../../reviews/plugin-architecture/general-architecture.md#arch-19) | Optional | Optional / bounded | Plugin form field/value declarations duplicate core form declarations | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-20](../../../reviews/plugin-architecture/general-architecture.md#arch-20) | Optional | Optional / bounded | Timestamp conversion is repeated in mutation consumers | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-22](../../../reviews/plugin-architecture/general-architecture.md#arch-22) | None | Withdrawn | CLI and TUI Board resolution have different, appropriate responsibilities | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [ARCH-31](../../../reviews/plugin-architecture/general-architecture.md#arch-31) | Optional | Optional / bounded | Commander handlers repeatedly pass their trailing Command to cli.run | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [ARCH-32](../../../reviews/plugin-architecture/general-architecture.md#arch-32) | P2 | Recommended / see scope | Several extension points are fixture-tested rather than built-in-used | Required. |
| [CQ-01](../../../reviews/plugin-architecture/code-quality.md#cq-01) | Optional | Optional | Repeated validation plumbing with different semantics. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-03](../../../reviews/plugin-architecture/code-quality.md#cq-03) | P2 | Useful | Core-command option input cannot use the existing repeatable parser. | Required. |
| [CQ-07](../../../reviews/plugin-architecture/code-quality.md#cq-07) | Optional | Optional | Long-text flag setup is repeated, but not identical. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-09](../../../reviews/plugin-architecture/code-quality.md#cq-09) | Optional | Optional | Repeated removal of the reserved enabled setting. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-11](../../../reviews/plugin-architecture/code-quality.md#cq-11) | Optional | Optional | First-letter capitalization has three copies. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-12](../../../reviews/plugin-architecture/code-quality.md#cq-12) | Optional | Optional | Missing-record handling has three local copies. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-13](../../../reviews/plugin-architecture/code-quality.md#cq-13) | Optional | Optional | Repeated Board-result projection. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-14](../../../reviews/plugin-architecture/code-quality.md#cq-14) | P2 | Useful | Three wrappers for { plugins }. | Required. |
| [CQ-17](../../../reviews/plugin-architecture/code-quality.md#cq-17) | Optional | Optional | src/services/plugins/types.ts:215, src/services/types.ts:233: (string & {}) keeps known-name completion while allowing other strings. Add a short inline explanation at both loca… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-18](../../../reviews/plugin-architecture/code-quality.md#cq-18) | P2 | Useful | src/services/plugins/types.ts:394/:400, src/tui/components/Form.tsx:8/:21: both the field-kind union and value union are duplicated. Define PluginFieldKind once in service Plugi… | Required. |
| [CQ-20](../../../reviews/plugin-architecture/code-quality.md#cq-20) | Optional | Optional | Small comparator/plural duplication. | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-21](../../../reviews/plugin-architecture/code-quality.md#cq-21) | Optional | Optional | src/services/plugins/types.ts:131: OperationInput = OperationOptions. Either document the semantic alias or remove it and use OperationOptions at src/services/plugins/runtime.ts… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-26](../../../reviews/plugin-architecture/code-quality.md#cq-26) | Optional | Optional | src/services/plugins/types.ts:325, src/services/plugins/types.ts:465/:466: inline option/tab descriptions. Optional PluginOption and PluginTab<P> names can improve reuse, but on… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-50](../../../reviews/plugin-architecture/code-quality.md#cq-50) | P2 | Useful | src/plugin-api/index.ts:7 does not re-export Command, though commands receive it; src/plugins/comments/commands.ts:54 uses a structural generic to work around the import boundar… | Required. |
| [CQ-51](../../../reviews/plugin-architecture/code-quality.md#cq-51) | Optional | Optional | src/plugin-api/tui.ts:28 exports useToast alongside ui.toast/ui.error. No builtin/fixture uses the hook, but that alone is not dead code. Optional remove it if the intended publ… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-52](../../../reviews/plugin-architecture/code-quality.md#cq-52) | None | Withdrawn | src/plugin-api/index.ts:1 and src/plugin-api/tui.ts:1 already explain that these are deliberate API surfaces. Locally unused hooks/types/schemas can be needed by future Built-in… | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [CQ-53](../../../reviews/plugin-architecture/code-quality.md#cq-53) | P2 | Useful | src/plugin-api/index.ts:97/:98, src/services/plugins/host.ts:144: absent settings schema returns raw settings, while definePlugin defaults to Record<string, unknown>. Add that d… | Required. |
| [CQ-54](../../../reviews/plugin-architecture/code-quality.md#cq-54) | Optional | Optional | src/services/index.ts:19/:21 exports ActivePlugin/LoadPluginsOptions. No direct external consumers found, but LoadPluginsOptions describes an exported loader. Either keep for AP… | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [CQ-72](../../../reviews/plugin-architecture/code-quality.md#cq-72) | P2 | Useful | src/services/types.ts:147, src/services/stories.ts:261: document that a non-undefined filter for an off/unknown Plugin or one lacking filterStories throws UsageError. | Required. |
| [DX-01](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-01) | Optional | Optional / bounded | Common Story-field glue merits an optional, bounded helper | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-06](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-06) | None | Withdrawn | Standalone TUI types require redundant settings arguments; settings inference itself works | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [DX-07](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-07) | P1 | External milestone | Input validation is manual and loses useful diagnostics at hook boundaries | Implement per the package / §9 decision; if the condition does not apply, `deferred: <condition>`. |
| [DX-11](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-11) | Optional | Optional / bounded | Core-option conversion makes authors manage low-level Commander values | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-12](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-12) | P2 | Recommended / see scope | input on stories list actually returns filter criteria | Required. |
| [DX-22](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-22) | Optional | Optional / bounded | Pending-file reads and stored-file reads look similar; JSON convenience is optional | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-23](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-23) | Optional | Optional / bounded | Commander actions repeatedly forward the trailing Command into cli.run | Evaluate; implement only if the entry's condition holds, else `deferred: <reason>`. |
| [DX-30](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-30) | P2 | Recommended / see scope | An Action's target does not narrow the focus type | Required. |
| [DX-33](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-33) | P2 | Recommended / see scope | A few intentional type/helper exports would reduce deep-import temptation | Required. |
| [DX-34](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-34) | None | Withdrawn | Explicit return undefined in guards is not required (withdrawn) | None — withdrawn by the review. Do not implement the original prescription; any residual note in the package is optional. |
| [DX-35](../../../reviews/plugin-architecture/straightforwardness-for-plugin-authors.md#dx-35) | P2 | Recommended / see scope | Omitted settings schema is permissive; strictness should be an explicit author choice | Required. |
