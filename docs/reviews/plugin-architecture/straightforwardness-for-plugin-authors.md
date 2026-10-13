# Straightforwardness for third-party plugin authors

Reviewed 2026-10-13 against `5b3acd475968ad5577bdb0a2008f7f46be3639de` with GPT 6.1 Sol, xhigh. Scope: author experience, discoverability, unnecessary glue, and the gap between built-in authoring and external authoring. This is a source review, not an implementation. Only this report was written. No `pnpm test`, build, lint, or full project typecheck was run; the supervisor owns those checks. Small standalone Commander and compiler probes are reproduced below.

The earlier report was recovered in full from thread `mcp:48aed8d9-b34b-4658-af62-9a4adee90143`, assistant item `turn-item:provider:claudeAgent:native-item:4ad38438-f5ac-4b81-a9a6-d748dd438f83` (47,996 characters). IDs DX-01 through DX-35 are retained, including withdrawn claims, so a merged plan can reconcile both versions. New observations use DX-36 onward.

## Assessment and release boundaries

The basic declaration is small and understandable: three required strings, optional contributions, an identity `definePlugin`, namespaced bags, and one service pipeline shared by CLI and TUI. A display-only hello world needs five lines, no schema, hooks, or separate TUI module. A realistic Story field is harder because the author manually connects persistence, command parsing, filters, rows, and form conversion. The difficulty lies in contracts between those pieces, not in an inherently excessive number of required concepts.

Third-party authoring is intentionally unavailable today: ADR-0009 explicitly defers packaging and dynamic loading, and `docs/PLUGINS.md:11` says third-party Plugins are not built. That is a **blocker for claiming an external-plugin release**, not a regression or a blocker for releasing the built-in plugin system. This review does not independently reproduce the storage failures covered by the other reviewers. The supervisor's consolidated report establishes a current invalid-bag preservation release gate that overlaps DX-09; that is separate from external author readiness.

| Class | Findings | Execution boundary |
| --- | --- | --- |
| External-release requirements | DX-02 package entry points and loading; DX-14 compatibility policy | Complete before inviting authors to publish independently installed plugins. Do not quietly expand the current built-in release scope. |
| Current preservation release gate | DX-09's unchanged/invalid-bag case | Adopt consolidated WP05/P0; preserving opaque data precedes authoring shorthand. |
| High-value reliability and contract improvements | DX-07 validation; DX-09 clearing; DX-10 negation; DX-17 operation boundaries; DX-31 field failure policy; DX-36 hook-name diagnostics | Decide contracts with the runtime reviewer, then implement and document them together. |
| Useful author tooling and polish | DX-03–06, DX-08, DX-11–13, DX-15, DX-18, DX-20–21, DX-23–25, DX-29–30, DX-32–33, DX-35, DX-37–39 | Small changes or documentation first; these are not all release blockers. |
| Optional abstractions | DX-01 field helper; DX-16 scaffold; DX-19 advanced regrouping; DX-22 JSON/file facade; DX-26–28 TUI helpers | Do not turn the entire list into mandatory work. Extract only when a concrete example proves a meaningful reduction. |
| Withdrawn | DX-06's “settings never infer” subclaim; DX-34 explicit guard-return claim | Keep the working implementation. |

“Confirmed” means directly supported by current code or a probe. “Inferred” identifies author friction, future compatibility risk, or a predicted effect that was not exercised. Acceptance tests below are work for implementation owners; their presence does not mean they were run.

## Corrections to the recovered report

1. **DX-01 was over-severe and overgeneralized.** A universal `storyFields` expansion is optional, not critical. Comments has no core Story options, Story form contribution, or filter; Specs has no `storyRows`. The shared-field pattern exists in Epics, Specs, and the Notes fixture, not all three built-ins.
2. **DX-02 is deliberate future work.** Source-relative imports and an injected registry already work inside a checkout. What is missing is a supported distributable entry and installed-package loading. ADR-0010 warns about executing committed configuration; it does **not** prescribe the earlier report's `trustedPlugins` key or `plugins trust` command.
3. **DX-04 misstated documentation.** `docs/PLUGINS.md:285` already says “by commander attribute name”; `types.ts:327` says the same. The missing detail is a camelCase example and exact value/absence semantics, not the entire naming rule. Built-in registry and glossary requirements are already stated at `docs/PLUGINS.md:180` and `:174`.
4. **DX-06 settings inference works.** The probe below compiles a schema without `definePlugin<Settings>` and checks `settings.marker` as a string in `start`, `storyRows`, and the returned definition. Missing defaults on standalone TUI types remain a small issue.
5. **DX-07 error-code comparison was wrong.** `runtime.ts:145–153` wraps both Zod errors and `ValidationError` from hooks as `PluginError`/exit 1. Epics does not preserve exit 2 inside a transform. Errors thrown by CLI input conversion or a plugin operation's body take a different path and can retain exit 2. The actual issue is boundary-dependent validation, loss of issue details, and untyped input/filter plumbing.
6. **Timestamp claim narrowed.** Core `stories.update` sets `updatedAt` before plugin transforms (`src/services/stories.ts:192`). Specs does not forget timestamps on ordinary core create/edit. Its own unlink operation and doctor fix call `updateStory`/`setSpecs` without updating timestamps (`src/plugins/specs/specs.ts:128`, `src/plugins/specs/index.ts:109`); those are the specific inconsistent paths, retained as DX-38.
7. **DX-13 separate files are not mandatory.** `tui: async () => ({ storyForm: … })` works today for metadata-only contributions. Sharing a schema through a separate `model.ts` is a useful convention, not an API requirement; Notes imports its entry module from its lazy TUI module already. The earlier five-file/94-line baseline was not a minimum and mixed code, glossary, and wiring counts.
8. **DX-18 is a capability-design question.** Broad services are confirmed; malicious-plugin containment is not provided by a narrower TypeScript type, and legitimate commands can need core writes. Do not remove service methods based only on today's built-ins.
9. **DX-19 replacement semantics are intentional.** Skipping `core()` is the purpose of a replacement. Do not impose an unconditional call-core rule or silently change conflict order to configuration order; the current host uses registry order.
10. **DX-26/27/29 overstated repetition.** Not every delete flow uses `useKeyCapture`; error renderers differ and `useAsync` already toasts errors; Specs uses `PluginFinding[]` without `as const`. Optional helpers must accommodate these differences.
11. **DX-30 task focus guarantee narrowed.** Shell checks that the target exists; `ActionFocus` alone does not enforce that a task always carries a Story. Core task detail supplies both, but a discriminated type must either guarantee that runtime invariant or require only `task`.
12. **DX-34 is withdrawn.** Current TypeScript accepts a contextually typed `guard() {}` without explicit `return undefined`. No signature change is needed for that example.
13. **DX-35 recommendation narrowed.** Omitting a settings schema is permissive by design. Do not silently strip settings or add a new doctor code as a universal default. Offer/document strict schemas when authors need typo detection.

## Findings

### <a id="dx-01"></a>DX-01 — Common Story-field glue merits an optional, bounded helper

**Severity:** minor. **Class:** optional abstraction. **Evidence:** confirmed repetition; inferred benefit of extraction.

**Locations:** `src/plugins/epics/index.ts:6`, `:33`, `:41`, `:46`, `:57`; `src/plugins/epics/tui.ts:10`, `:33`; `src/plugins/specs/index.ts:25`, `:43`, `:71`, `:92`; `src/plugins/specs/specs.ts:143`; `src/plugins/specs/tui.ts:14`, `:28`; `test/plugins/fixtures/notes.ts:26`, `:44`, `:66`; `test/plugins/fixtures/notesTui.tsx:37`.

**Author problem:** Storing one editable value means writing a bag schema, a payload parser, create/update adapters, CLI conversion, filter matching, row formatting, and TUI field conversion. This is real glue, but Comments' thread operations and Specs' Markdown/link semantics are not instances of one universal field engine.

**Recommendation:** First document a complete simple field and fix DX-07/09/10. If the supervisor wants an extraction, add `src/plugin-api/storyField.ts` with a narrowly scoped helper, not implicit expansion/merging inside `loadPlugins`:

```ts
export function defineStoryFieldPlugin<T>(spec: {
  id: string; name: string; description: string;
  field: { name: string; label: string; schema: z.ZodType<T>;
    cliValue(raw: string): T; kind: 'text' | 'number';
    empty: null; format(value: T): string; };
}): PluginDefinition;
```

The helper owns its one-field bag, create/update hooks, same-name CLI option on create/edit/list, paired edit/list negation, exact-value list matching, row, and number/text TUI field/filter. No foreign-file validation, multi-field merge policy, arbitrary hooks, list-add/remove semantics, or permission engine. Do not automatically rewrite Specs or Comments. If composition is needed later, define it from an actual caller rather than saying “hand-written parts win.”

**Acceptance:** The exercise below has equivalent set/clear/filter/row behavior; zero is preserved; absent CLI flags preserve existing data; clearing removes only this plugin's bag; another plugin can reject before save; CLI startup imports no Ink/React runtime through the helper. If the helper fails to remain small, keep the recipe instead.

**Dependencies/ownership:** API owner; optional after DX-07/09/10. Conflicts with public exports (DX-02/33), form contract (DX-09), and runtime semantics (DX-17). One owner must coordinate these files; do not have several workers expand `PluginDefinition` independently.

### <a id="dx-02"></a>DX-02 — There is no supported external SDK package or installed-plugin loader

**Severity:** critical **only for an external-plugin release**. **Class:** external-release requirement. **Evidence:** confirmed absence; intentional scope decision.

**Locations:** `docs/PLUGINS.md:11`, `:16`; `docs/adr/0009-built-in-plugins-use-only-the-plugin-api.md:3`; `src/cli.ts:2`; `src/plugins/index.ts:8`; `src/main.ts:99`, `:103`; `src/services/plugins/host.ts:65`, `:97`; `package.json:6`, `:11`; `tsup.config.ts:4`.

**Author problem:** A checkout can import `src/plugin-api`, and callers can inject a registry into `main`; the distributed package is private, builds only the CLI, has no API exports/types, and treats configuration IDs absent from that registry as unknown. An independent npm plugin cannot be installed and enabled through a documented path.

**Recommendation:** Split into coordinated deliverables: (a) supported exports `rowbly/plugin`, `rowbly/plugin/tui` with emitted declarations; (b) one explicit external registry source, separate from a plugin's settings; (c) a documented local authorization policy before evaluating external modules. For example, a future locally installed manifest may contain `{ id, module }` and feed definitions to existing `loadPlugins`; do not put a `package` setting beside `enabled` without reserving/removing it before schema parsing. Resolve module paths against an explicitly documented location, validate exported definition and ID, and preserve deterministic registry order. Keep builtin registry injection for tests. The loader/trust mechanism is an architectural decision, not settled by this report.

Proposed packaging minimum:

```json
{"exports": {
  "./plugin": {"types":"./dist/plugin-api/index.d.ts","import":"./dist/plugin-api/index.js"},
  "./plugin/tui": {"types":"./dist/plugin-api/tui.d.ts","import":"./dist/plugin-api/tui.js"}
}}
```

Build those entries deliberately; keep the shebang on the CLI entry only. Check dependency/peer choices and avoid separate copies of React contexts or error constructors between plugin and host. A narrower SDK type does not sandbox arbitrary imported JavaScript.

**Acceptance:** In a clean consumer directory, install the packed artifacts, compile a plugin using only public imports, explicitly install/authorize it, enable it, and exercise both CLI and TUI. Missing package, ID mismatch, incompatible API, and bad export become per-plugin load reasons while other plugins work. Mere committed config cannot silently execute an unapproved module. Node can import `rowbly/plugin` without loading Ink/React runtime.

**Dependencies/ownership:** Packaging/loader owner plus security/runtime reviewer. DX-14 and DX-33 must settle the public contract first; DX-15 uses these entries. Do not let the docs or scaffold worker independently select manifest keys, module resolution, or trust UX.

### <a id="dx-03"></a>DX-03 — Author instructions begin with architecture rather than a runnable progression

**Severity:** minor. **Class:** useful improvement. **Evidence:** confirmed layout; inferred onboarding cost.

**Locations:** `docs/PLUGINS.md:178`, `:182`, `:222`, `:256`, `:288`, `:304`; `README.md:44`.

**Author problem:** The authoring section appears after architecture and three built-in feature descriptions. Its first object lists almost every contribution, including hooks and doctor, even though only three strings are required. It is accurate to call this a built-in guide today, but not a future external quickstart.

**Recommendation:** Add `docs/WRITING-A-PLUGIN.md`, linked from README's Plugins section and `docs/PLUGINS.md:5`. Order: supported scope/imports; five-line read-only hello world; how to run/enable it; complete editable field; optional commands; metadata-only TUI fields; lazy component screens; operation lifecycle; files/doctor/settings; tests; advanced replacements. Keep ADR history and feature catalogs in PLUGINS.md. Use today's source imports until DX-02 ships; never show an unavailable public path as if executable today.

**Acceptance:** A reader following the first example can see a row in CLI and TUI without opening a built-in implementation. Each example compiles against the current API. Clear headings distinguish repository-only steps from future external installation.

**Dependencies/ownership:** Documentation owner; consume DX-04/05/09/10/13/15/36 decisions. Does not depend on optional DX-01. Avoid simultaneous PLUGINS.md edits by other reviewers.

### <a id="dx-04"></a>DX-04 — The guide needs precise boundary examples, not wholesale replacement

**Severity:** minor (unsafe payload example is more consequential). **Class:** useful improvement. **Evidence:** confirmed omissions/examples.

**Locations:** `docs/PLUGINS.md:192`, `:208`, `:229`, `:231`, `:284`, `:285`, `:289`, `:295`, `:306`; `src/services/plugins/types.ts:242`, `:327`; `src/tui/hooks/plugins.ts:33`.

**Author problem and exact edits:**

| Section | Current issue | Specific edit |
| --- | --- | --- |
| Definition/context | `settings: z.object({})` looks like required boilerplate; context table omits `id`. | Show the minimal declaration first; describe optional schema, parsed settings, permissive omission, and `plugin.id`. |
| Operations and Change Sets | `pluginInput as object` is written without checking payload shape. Core record validation does not validate this plugin's bag schema at write time. | Replace with `safeParse`/explicit validation and state hook-error policy. Avoid teaching assertions as validation. |
| Command mode | Attribute naming is stated, but `--add-spec` → `addSpec`, missing values, negation, and repeatables are not demonstrated together. | Add a table: absent → `undefined`, paired negation → `false`, value flag → string, repeatable → string array; `undefined` callback output omits payload. Distinguish `repeatable:true` for core options from `cli.collect` on plugin-owned commands. |
| TUI | Empty-field clearing, number `0`, select sentinels, `active`/key capture, and breadcrumb `params.title` are not taught. | Add complete create/edit conversion and one screen example; identify reserved routing keys (DX-24). |
| Tests | Points to fixture helpers that cannot be imported from an external package. | Label them repository examples, give an explicit setup recipe now, link the public harness only when it exists. |

**Acceptance:** Examples have no unchecked bag writes, distinguish create-empty from edit-clear, preserve zero/false, and match actual callback names. Example compilation belongs in doc validation; no need for tests that simply mirror prose.

**Dependencies/ownership:** Documentation owner, coalesce with DX-03. Runtime/API decisions DX-07/09/17 must be reflected; fixes explaining today's behavior can proceed immediately.

### <a id="dx-05"></a>DX-05 — There is no minimal complete hello world, and built-in integration needs a checklist

**Severity:** minor. **Class:** useful improvement. **Evidence:** confirmed; prior “hidden requirements” claim narrowed.

**Locations:** `docs/PLUGINS.md:174`, `:180`, `:206`; `src/plugins/index.ts:8`; `test/e2e/language.test.ts:32`, `:34`, `:37`; `test/architecture.test.ts:111`; `CONTEXT-MAP.md:5`.

**Author problem:** The docs mention registry, glossary, map, and import rules, but provide no smallest complete working example or checklist linking those steps to enablement. The language audit blindly reads every plugin directory's glossary. An empty glossary yields an empty alternation regex, so suggesting a token empty CONTEXT.md is also unsafe. Map inclusion is a documented convention; this review found no test enforcing it.

**Recommendation:** Include the five-line example below and a built-in checklist: create folder/definition; add import/registry entry; add a meaningful glossary and map link; enable ID; use only allowed imports. Do not make shipped built-ins' glossary optional simply to save lines. Harden `pluginAvoidWords()` to skip regex creation when no `_Avoid_` words exist, or report a precise glossary error; decide whether non-plugin helper directories should be ignored. External packages should not inherit repository language-audit requirements unless deliberately published.

**Acceptance:** A minimal meaningful built-in works by following the checklist; missing/empty glossary produces an intelligible result rather than arbitrary matching. No external installation claim before DX-02.

**Dependencies/ownership:** Docs owner with test/language owner. DX-03 handles placement; optional DX-16 may generate this checklist's files. Do not weaken project language policy without supervisor agreement.

### <a id="dx-06"></a>DX-06 — Standalone TUI types require redundant settings arguments; settings inference itself works

**Severity:** nit. **Class:** useful improvement. **Evidence:** confirmed repeated annotations; inference claim withdrawn by compiler probe.

**Locations:** `src/plugin-api/index.ts:98`; `src/services/plugins/types.ts:386`, `:407`, `:413`, `:421`, `:427`, `:435`, `:444`, `:458`; `src/plugins/epics/tui.ts:7`; `src/plugins/specs/tui.ts:9`; `src/plugins/comments/tui.ts:5`.

**Author problem:** An independently declared screen/TUI module must write `PluginScreenProps<Record<string, unknown>>` or `PluginTui<Record<string, unknown>>` even without settings. The schema passed to `definePlugin` already infers settings; do not rewrite that function to fix a nonexistent issue.

**Recommendation:** Add `= Record<string, unknown>` defaults consistently to standalone settings-parameterized plugin interfaces that need them. Keep explicit settings types where used. Recommend `satisfies PluginTui<Settings>` or an annotation; another identity `definePluginTui` is optional and not necessary.

**Acceptance:** `PluginTui`/`PluginScreenProps` can be used without a generic; a schema with `marker:string` still infers typed settings in contextual callbacks; accessing a nonexistent setting fails in a typed plugin. Existing built-ins compile with simpler annotations.

**Dependencies/ownership:** API/type owner; coordinate every types.ts edit with DX-07/17/30/33. No dependency on packaging.

### <a id="dx-07"></a>DX-07 — Input validation is manual and loses useful diagnostics at hook boundaries

**Severity:** major. **Class:** useful improvement; settle before freezing the external API. **Evidence:** confirmed plumbing/error policy; inferred author-error frequency.

**Locations:** `src/services/plugins/types.ts:189`, `:330`, `:410`, `:416`, `:499`; `src/services/plugins/runtime.ts:71`, `:145`, `:149`; `src/plugins/epics/model.ts:22`; `src/plugins/specs/specs.ts:145`; `src/plugins/specs/index.ts:51`; `test/plugins/fixtures/notes.ts:32`; `src/tui/components/Form.tsx:70`, `:136`; `src/tui/screens/stories/pluginFields.ts:11`.

**Author problem:** CLI input converter, TUI converter, hook, and filter share no declared payload type. Epics validates, Specs parses raw Zod data, Notes silently ignores invalid input. Hook validation failures become INTERNAL with a disable hint; the wrapper retains only the Rowbly error code as `details.cause`, not validation issues. TUI inline validation recognizes `ValidationError`, and field names are prefixed `plugin:<id>:<name>`, so even preserving unprefixed issues alone would not identify plugin fields correctly.

**Recommendation:** Provide optional per-operation input schemas rather than one compulsory shape for every operation:

```ts
// Sketch: infer each I from schema output; absence is still explicit.
interface PluginPayload<I> { schema: z.ZodType<I>; }
type PluginInputSchemas = Partial<Record<CoreOperationName, z.ZodType>>;
// PluginDefinition: inputs?: PluginInputSchemas; storyFilterSchema?: z.ZodType;
// A hook for K receives pluginInput: OutputOfInputs[K] | undefined.
```

Validate only supplied payloads before invoking the operation's body/hooks; use output types for defaults/transforms. Filter schema parsing occurs once per list invocation, before scanning stories. Invalid payloads throw `ValidationError` with `details.plugin` and issues. Adopt consolidated Decision 7: expected Rowbly validation/missing-record/conflict errors retain their domain meaning and gain attribution; unexpected handler failures remain INTERNAL. That intentionally changes ADR-0012's blanket wrapping policy and requires its documentation to be updated. Map validation paths from the plugin payload to actual prefixed form fields at the TUI adapter, preserving unrelated issues as form-level errors. For plugin-owned operations, allow validation at the declared operation/body boundary without pretending `input.plugins[id]` is that operation's entire input.

A single `input?: ZodType<I>` can be a convenience later for a uniform field plugin, but making it the sole schema for all supported core operations would create new restrictions. Keep `unknown` as an honest fallback for untyped cross-plugin operations.

**Acceptance:** Invalid Epics/Specs-style payload through CLI, TUI, and service calls produces the chosen expected-input error, names the plugin, retains issues, and saves nothing; actual thrown transform bugs remain INTERNAL. `undefined` bypasses optional parsing; `null`, `false`, zero, empty arrays, schema defaults/transforms behave deliberately. Compile fixtures reject converters that disagree with declared output types. A bad number appears inline under the plugin field rather than suggesting disabling the plugin.

**Dependencies/ownership:** WP01 error adapter with WP04 types; conflicts with DX-11/12 API shapes, DX-17 context split, and DX-39 error wrapping. Coordinate ADR-0012 wording and existing `pipeline.test.ts:47`/`cli.test.ts:123` expectations; retain attribution when preserving expected errors.

### <a id="dx-08"></a>DX-08 — New Story lookup is repetitive and has an implicit subject assumption

**Severity:** minor. **Class:** useful improvement. **Evidence:** confirmed repetition; inferred future ambiguity.

**Locations:** `src/plugins/epics/index.ts:35`; `src/plugins/specs/index.ts:27`; `test/plugins/fixtures/notes.ts:46`; `docs/PLUGINS.md:229`; `src/services/plugins/types.ts:184`; `src/services/plugins/runtime.ts:68`.

**Author problem:** `stories.create` input has no key; each transform searches for the first Story change with `before === null`. Another earlier transform/replacement can add records, so “first created Story” is a convention, not a universally safe operation subject.

**Recommendation:** Prefer a typed operation subject/result supplied from the **core body's actual result**, not another scan of the change list. For the narrow create case add `createdStoryKey` or `subject: { type:'story'; key:StoryKey }` to that operation event, computed after body/replacement and before transforms. Resolve its current record through `changes.story(key)`. Define deletion and replacement-without-core behavior explicitly before extending to every operation. A documented `createdStory(changes)` helper is smaller but cannot fix ambiguity and should be labeled accordingly.

**Acceptance:** With two created Stories in the Change Set, the adapter changes the operation's actual created Story. Replacement cases either provide the subject contract or fail clearly; deleted records are not typed as guaranteed present. No optional `event.story` sprinkled onto unrelated bulk operations.

**Dependencies/ownership:** Runtime owner; DX-01 may consume this. Conflicts with pipeline/result reviewer and DX-19; do not independently change `CoreOperations` without coordinating.

### <a id="dx-09"></a>DX-09 — Empty TUI values must mean clear on edit, not “no input”

**Severity:** major. **Class:** current P0 preservation gate for unchanged invalid bags; useful improvement for clear/absent ergonomics. **Evidence:** confirmed source contract; supervisor independently reproduced invalid-bag erasure, as recorded in `docs/reviews/plugin-architecture/README.md` under Independent verification. This reviewer did not rerun that reproduction.

**Locations:** `src/services/plugins/types.ts:409`; `src/tui/screens/stories/pluginFields.ts:56`, `:88`; `src/plugins/epics/tui.ts:26`; `test/plugins/fixtures/notesTui.tsx:42`; `src/plugins/epics/index.ts:7`.

**Author problem:** `input(values)` that returns `undefined` for empty values works on create but retains the old value on edit. The host omits that plugin payload entirely; only a plugin-defined explicit clear such as `{ epic:null }` tells the transform to remove data. `null` is not a universal core convention for arbitrary payload fields; it is agreed between the author's adapters.

There is an opposite current failure: `readBag` conflates invalid and missing (`runtime.ts:185`), and the working built-in converter emits clear even if the user never touched an invalid field (`epics/tui.ts:26`; Specs always emits an array at `specs/tui.ts:26`). An unrelated edit can therefore erase opaque invalid data. Adding a better tutorial alone does not fix this.

**Recommendation:** Adopt WP05's explicit dirty/clearing contract and suppress mutation payload for unchanged plugin fields; retain raw invalid/unsupported bags through unrelated edits. Distinguish missing, invalid, supported, and unsupported data through an inspection result or adapter state rather than interpreting parse failure as empty. Add a create/edit truth table and complete converter to `PluginStoryForm.input` JSDoc and the guide. An object argument `{ values, initialValues, story, changedFields }` can expose the contract without extra service reads. Dirty comparison must use **normalized form values**, including missing/default, number null, boolean false, and array equality; comparing submitted numbers to raw initial strings is wrong. If callbacks also provide submit validation, keep that validation distinct from whether they emit mutation payload.

**Acceptance:** Existing value → empty clears; empty create leaves no bag; unchanged edit preserves valid, invalid, unknown-key, and future-version bags byte/semantically as promised; zero/false/[] do not disappear through truthiness; own bag removal preserves other bags. A failed field provider cannot produce a clear payload. Use meaningful CLI/TUI parity checks, extending `test/plugins/epicsTui.test.tsx`'s clear case.

**Dependencies/ownership:** WP05 TUI preservation with WP04 form/bag types and WP08 built-in adapters, coordinated with DX-07/20/31. The optional DX-01 helper must inherit these semantics. Documentation can precede API work, but does not satisfy the data-preservation gate.

### <a id="dx-10"></a>DX-10 — A lone negated core option supplies input even when the user gives no flag

**Severity:** major. **Class:** useful improvement. **Evidence:** confirmed with installed Commander probe.

**Locations:** `docs/PLUGINS.md:285`; `src/services/plugins/host.ts:194`; `src/commands/plugins.ts:104`; `src/commands/_shared.ts:73`; `src/plugins/epics/index.ts:20`, `:53`.

**Author problem:** Commander initializes `x:true` for a lone `--no-x`; paired `--x <v>`/`--no-x` does not produce that default. `pluginInput` invokes the converter every command, so a naïve author can accidentally transform/filter ordinary invocations. The docs correctly warn, but the host does not help.

**Recommendation:** Smallest fix: when gathering option values, use Commander's option-source information to distinguish supplied CLI options from default values, and leave a negation-only option absent when not supplied. Alternatively add a paired `negatable` option declaration. Choose one normalized contract and document it; do not introduce `false → null` globally because existing filters use `false` deliberately. If retaining pairing as the supported rule, detect a lone `--no-x` with a precise load diagnostic instead of hoping authors read prose.

**Acceptance:** No flag yields no plugin payload; `--no-x` is distinguishable; positive/negative flags together have a documented last-wins or rejection rule; repeatables and explicit defaults remain deliberate. Ordinary unfiltered lists cannot silently become “x:true” filtered lists.

**Dependencies/ownership:** CLI/runtime owner; overlaps DX-11/32 and existing clash detection. Do not ship both source tracking and an incompatible global normalization without a unified decision.

### <a id="dx-11"></a>DX-11 — Core-option conversion makes authors manage low-level Commander values

**Severity:** minor. **Class:** useful improvement; automatic mapping optional. **Evidence:** confirmed.

**Locations:** `src/services/plugins/types.ts:323`; `src/commands/_shared.ts:69`; `src/plugins/epics/index.ts:49`, `:53`; `src/plugins/specs/index.ts:5`, `:79`; `test/plugins/fixtures/notes.ts:76`.

**Author problem:** Converters receive `Record<string,unknown>`, keyed by camelCase option attributes, with strings, arrays, booleans and `undefined`. Every simple converter checks absence and maps `false` into its own clear signal. The type/comment states attribute names but offers little help reconstructing a payload.

**Recommendation:** Document `--add-spec → addSpec` and raw values immediately. Introduce an exported `PluginOption` alias and `PluginOptionValues = Record<string,string|string[]|boolean|undefined>` **only after** validating the allowed flag grammar cannot introduce other types. If useful, allow explicit payload mapping `valueKey:'points'` plus a parser, but keep `{ options,input }` for Specs' set/add/remove rules. Do not add array shorthand with schema coercion until DX-07/10 contracts are fixed; `z.coerce.number()` can convert unintended values such as null/empty strings to zero.

**Acceptance:** Kebab-case, repeatable, negated, omitted, zero, and invalid numeric examples are typed/documented correctly; converter still sees only its claimed option attributes. Existing complex adapters need no workaround.

**Dependencies/ownership:** CLI/API owner; DX-07/10 precede automatic conversion. Shared-file conflicts with DX-12/23/33.

### <a id="dx-12"></a>DX-12 — `input` on `stories list` actually returns filter criteria

**Severity:** minor. **Class:** useful improvement. **Evidence:** confirmed intentional dual meaning.

**Locations:** `src/services/plugins/types.ts:328`; `src/commands/stories.ts:87`; `src/plugins/epics/index.ts:55`; `src/plugins/specs/index.ts:87`; `src/services/stories.ts:261`.

**Author problem:** The same method name means operation payload on modifying commands and predicate criteria on list. CLI filters and TUI `storyFilter.filter` must agree without a common type/schema.

**Recommendation:** At minimum rename/document this callback as `parse` with a command-specific result. If DX-07 adds filter typing, give list conversion an explicitly typed `filter(values): F|undefined` while modifying commands use `input(values): I|undefined`; model the entry as a discriminated mapped type. A separate top-level `listOptions` is optional; choose it only if it improves the examples, not simply to relocate code. Keep filter-summary `describe` explicit unless a helper owns the labels/value formatting.

**Acceptance:** Compiler checks distinguish list criteria from mutation input; CLI and TUI produce the same filter schema; no changes to any/all matching (Specs uses any selected slug).

**Dependencies/ownership:** API/CLI owner after DX-07. Conflicts with DX-11 and docs; serialize type-shape changes.

### <a id="dx-13"></a>DX-13 — Lazy component loading is useful; export-unwrapping is small boilerplate

**Severity:** nit. **Class:** useful improvement; object shorthand optional. **Evidence:** confirmed; earlier mandatory-file claim withdrawn.

**Locations:** `src/services/plugins/types.ts:506`; `src/tui/loadPlugins.ts:15`; `src/plugins/epics/index.ts:84`; `src/plugins/specs/index.ts:123`; `src/plugins/comments/index.ts:18`; `test/plugins/fixtures/notes.ts:150`.

**Author problem:** All built-ins repeat `() => import('./tui').then(m => m.tui)`. The deliberate lazy split prevents CLI startup from importing Ink/React. Metadata-only TUI contributions already work inline through `async () => ({…})`; they need no second file.

**Recommendation:** Document both existing forms now. Optionally accept `tui?: PluginTui<S> | (() => Promise<PluginTui<S>>)` for metadata shorthand. If accepting module objects, choose **one** supported export (`default` or named `tui`) rather than a permissive multi-shape loader; a typed `lazyTui(() => import('./tui'))` helper is another small option. Preserve lazy loading for component imports.

**Acceptance:** Metadata-only one-file example works; a CLI invocation never evaluates a component module; failed lazy loading still marks only that plugin failed. No cyclic-module claim or third-file requirement in docs.

**Dependencies/ownership:** API/TUI loader owner; overlaps DX-02/06. No prerequisite for documenting current inline async syntax.

### <a id="dx-14"></a>DX-14 — Independently shipped plugins need an explicit compatibility policy

**Severity:** major, conditional on external release. **Class:** external-release requirement. **Evidence:** confirmed absent policy; inferred future mismatch risk.

**Locations:** `src/services/plugins/types.ts:481`; `src/services/plugins/host.ts:20`, `:85`; `src/plugin-api/index.ts:98`; `package.json:3`.

**Author problem:** Host package version exists, but no declared plugin API compatibility is validated. A future independently built plugin can load successfully and fail later when it calls an unavailable context method. This is not a current built-in mismatch, since they ship together.

**Recommendation:** Choose either a validated package peer-version range or a small explicit `apiVersion:1` in external definitions, with a public API version constant. Do not infer compatibility from `known`. Require the external loader to reject incompatibility before `start` and expose a reason naming required/supported versions. Distinguish API version from bag/file schema versions: a field format change needs its own storage migration strategy. Avoid non-enumerable stamping magic unless it is necessary for a documented helper contract.

**Acceptance:** Compatible, too-new, missing/invalid version cases have deterministic outcomes before hooks execute; plugin list/show conveys the mismatch. A storage-version example explains preserving off/unknown plugin data without attempting a speculative migration framework.

**Dependencies/ownership:** Packaging/API owner with DX-02; no immediate change required for built-in-only release. Share version policy with docs and harness.

### <a id="dx-15"></a>DX-15 — Useful repository test helpers are not a public plugin-author harness

**Severity:** major for external onboarding, minor for built-ins. **Class:** useful improvement. **Evidence:** confirmed.

**Locations:** `test/plugins/helpers.ts:3`, `:28`, `:43`; `test/helpers/globalSetup.ts:8`; `test/helpers/runCli.ts:34`; `test/plugins/fixtures/cli.ts:2`; `test/tui/helpers.tsx:55`; `docs/PLUGINS.md:306`.

**Author problem:** Service tests require internal context/root construction; CLI tests bundle a second registry entry point; TUI tests import App, router, loader, toast store and Ink utilities. These are good examples but cannot be imported by an external npm plugin.

**Recommendation:** Stage a small `rowbly/plugin/testing` entry (`src/plugin-api/testing.ts`) after DX-02. Start with:

```ts
createPluginTestHost({ plugins, boards?, now?, newId?, me? }): Promise<{
  services: PluginTestServices; warnings: string[];
  context(id: string): PluginContext; dispose(): Promise<void>;
}>;
validatePluginDefinition(definition): PluginDefinitionDiagnostic[];
```

Enable supplied definitions explicitly in an isolated temporary Data Root, exercise actual pipeline/storage, expose deterministic clock/IDs and disposal. Keep testing-only unrestricted service helpers distinct from production hook context. Reuse it in existing tests to prevent drift. CLI subprocess support can follow as an adapter over a registry entry; do not require a broad in-process stream refactor or universal TUI renderer for v1. Offer a documented Ink screen test setup before promising a complete public TUI harness.

**Acceptance:** A consumer plugin test uses no `src/services`, `src/main`, storage, or Rowbly test imports; set/clear and guard/no-save can be tested with deterministic outputs and cleaned-up roots. Harness does not load Vitest/Ink testing libraries into production CLI imports. CLI harness must isolate global `process.exitCode`/streams if in-process execution is selected.

**Dependencies/ownership:** Testing/packaging owner after DX-02; DX-32 contributes validation. Runtime changes DX-07/17 must be reflected. Avoid simultaneous refactors of all test helpers.

### <a id="dx-16"></a>DX-16 — A scaffold is convenient after a stable runnable example exists

**Severity:** nit. **Class:** optional tooling. **Evidence:** confirmed no command; inferred author convenience.

**Locations:** `src/commands/plugins.ts:37`, `:80`; `docs/PLUGINS.md:180`.

**Author problem:** There is no starter generation; authors may copy a large built-in. That does not establish a release blocker or justify automatic edits to core registry/map files.

**Recommendation:** First publish a small copyable template. If author demand warrants it, add `rowbly plugins scaffold <id> --dir <path>` producing package metadata, one definition, and one harness test matching shipped public entries. Generate `tui.ts` only when components are requested. Built-in mode can print registry/map instructions; automatically rewriting these files introduces unnecessary mutation/conflict risk.

**Acceptance:** Fresh scaffold compiles and tests with the declared compatible SDK; refuses overwriting existing files; validates ID and unavailable/reserved names. No commented future APIs or mandatory unused modules.

**Dependencies/ownership:** Tooling owner after DX-02/03/14/15. Shared command file conflicts DX-23/32; optional, do not block other work.

### <a id="dx-17"></a>DX-17 — Hook types expose nested writes and guards expose mutable Change Sets

**Severity:** major. **Class:** reliability improvement before a stable author contract. **Evidence:** confirmed exposure; nested-save outcome inferred from runner structure, not integration-tested here.

**Locations:** `src/services/plugins/types.ts:190`, `:192`, `:206`, `:253`; `src/services/plugins/runtime.ts:66`, `:73`, `:104`, `:202`, `:205`; `docs/PLUGINS.md:217`, `:245`; `src/services/plugins/changeSet.ts:155`.

**Author problem:** Docs prohibit data-changing service calls from handlers, but transform/guard/react all receive the same full context. A nested `stories.update` or `plugin.operation` creates a separate runner/Change Set and may save before an outer guard rejects; self-hooking can recurse. Guards also receive `PluginChangeSet` even though their intended role is inspection. Reactions receive a readonly list, but contained `Change.after` records remain mutable types/references.

**Recommendation:** Introduce phase-specific contexts/events. Transform/replacement: pending Change Set writes plus read service facade; guard: deep-readonly view plus read facade; reaction: saved readonly view plus external effects and warnings. Commands/screens retain normal command capabilities. Remove `operation` and `editText` from hook contexts. Document that service reads see stored records, whereas `changes.updateStory`/`changes.readFile` see pending writes. Add a runtime boundary for forbidden reentrant writes if the architecture owner wants enforcement against JS/unchecked callers; types alone are not isolation. Choose an explicit rejection behavior instead of covertly joining nested transactions.

```ts
interface PluginHookContext<S> extends PluginReadContext<S> { warn(message:string):void; }
type GuardEvent<I,S> = Omit<OperationEvent<I,S>, 'changes'|'plugin'> & {
  changes: ReadonlyChangeSetView; plugin: PluginHookContext<S>;
};
```

**Acceptance:** Compile fixtures reject a hook's core write/nested operation and a guard's mutation; a command can still perform authorized core writes. If runtime enforcement is implemented, a JS hook cannot leave a nested saved change when the outer guard rejects. Existing transformations still update pending data in one save; reactions preserve documented warning behavior.

**Dependencies/ownership:** Runtime/architecture owner, highest shared-file contention with DX-07/08/18/19. Coordinate with the safety reviewer; no SDK type restriction should be presented as a security sandbox.

### <a id="dx-18"></a>DX-18 — Production context exposes the entire service layer without phase guidance

**Severity:** minor. **Class:** useful surface review. **Evidence:** confirmed breadth; external permission implications inferred.

**Locations:** `src/services/plugins/types.ts:253`; `src/services/types.ts:353`; `src/plugin-api/index.ts:91`; `src/plugins/epics/service.ts:70`, `:96`; `src/plugins/specs/specs.ts:57`, `:62`; `src/plugins/comments/comments.ts:21`, `:107`.

**Author problem:** Every core service—including setup, plugin enable/disable, doctor fixes and identity changes—is offered equally in every context. Common author tasks are obscured among administrative operations, and current examples mostly use reads. This does not prove core mutations are unnecessary for future commands.

**Recommendation:** Publish an explicit read facade for DX-17 and document read-vs-command method categories. Keep command contexts capable of deliberate core operations; do not whitelist only today's built-ins or delete `Services` without an inventory of supported workflows. If a production `PluginServices` interface is introduced, define it as a stable documented contract separate from internal `Services` and verify needed administrative plugin cases before removing methods.

**Acceptance:** Hook autocomplete shows useful reads and cannot advertise independent saves. Command examples for reading and moving Stories remain simple. Docs explain authorization and phase boundaries without claiming sandboxing.

**Dependencies/ownership:** API/runtime owner with DX-17; conflicts with packaging declaration generation DX-02. Useful documentation can proceed without narrowing all commands.

### <a id="dx-19"></a>DX-19 — Replacements are advanced and should be taught as such

**Severity:** minor. **Class:** documentation improvement; API regrouping optional. **Evidence:** confirmed powerful semantics; misuse frequency inferred.

**Locations:** `src/services/plugins/types.ts:218`, `:492`; `src/services/plugins/runtime.ts:77`, `:87`; `test/plugins/fixtures/others.ts:5`; `docs/PLUGINS.md:243`.

**Author problem:** A replacement can skip core validation/allocation and supply the result. The first registry claimant owns that operation and later replacements fail to load. No shipped built-in currently uses this power. A simple field author can easily mistake replacement for the standard way to modify a result.

**Recommendation:** Keep normal transforms as the tutorial path. Put replacements in an advanced reference explaining result obligations, core-error pass-through, shared pending Change Set, order, and deliberate omission of `core()`. If desired later, expose an `advanced` namespace, but do not require `core()` or add a `skipCore` protocol absent a concrete need. Define behavior for multiple calls to `core()`; the current closure can be invoked more than once.

**Acceptance:** A documented transform example covers common decoration; replacement examples cover both intentional complete replacement and core delegation; conflict and core-error tests remain. If call-once enforcement is chosen, repeat `core()` has a precise plugin diagnostic and saves nothing.

**Dependencies/ownership:** Runtime/docs owners; DX-08 subject contract must handle replacements. Conflicts with pipeline reviewer; optional API relocation should not block release.

### <a id="dx-20"></a>DX-20 — Nullable selects require plugin-defined string sentinels

**Severity:** minor. **Class:** useful improvement; new select API optional. **Evidence:** confirmed.

**Locations:** `src/services/plugins/types.ts:397`; `src/plugins/epics/tui.ts:21`, `:27`, `:40`, `:45`; `src/tui/components/Form.tsx:41`, `:178`; `src/tui/screens/stories/shared.tsx:10`.

**Author problem:** Selects accept an initial null but navigation cycles only string options; after selecting an actual value there is no general “clear” option. Epics invents `No Epic` for clear and `All Epics` for no filter. These are different states and should not be collapsed. A literal sentinel can collide with actual display values if it is not constrained as the Epic slug is.

**Recommendation:** Document the current sentinel recipe and both filter states. If shared controls are changed, add typed choices `{label:string,value:string|null}` or a smaller `noneLabel?:string` for optional selects, with null round-tripping and required-field validation. Keep no-filter distinct from match-unset for filters, e.g. a separate “Any” choice. Do not export the private Story screen's `NONE` merely to make strings globally coupled.

**Acceptance:** Select a value then clear it; null validates only when optional; real values cannot collide with labels; filter “any” and “without value” yield different criteria. Current Epics text remains understandable and correct.

**Dependencies/ownership:** WP05 shared Form with WP04 types and WP08 Epics adapter. Coordinate DX-09 dirty normalization and DX-31 loading failure. A new nullable-choice API is optional under the consolidated scope guard.

### <a id="dx-21"></a>DX-21 — Editor launch is visible in TUI and hook contexts despite being CLI-only

**Severity:** minor. **Class:** useful improvement. **Evidence:** confirmed callable capability; display corruption inferred, not launched here.

**Locations:** `src/services/plugins/types.ts:260`; `src/services/plugins/runtime.ts:207`; `src/plugins/specs/commands.ts:57`; `src/commands/plugins.ts:133`.

**Author problem:** `plugin.editText` appears on the context a screen gets, although JSDoc says command mode only. There is no check or type boundary preventing an external editor from being spawned beneath Ink.

**Recommendation:** Move `editText(initial):Promise<string>` to `PluginCommandEnv`, beside `readText`; update Specs to `env.editText`. Remove it from hook/TUI contexts. Preserve VISUAL/EDITOR and whitespace behavior deliberately; existing `readText` already provides common text/file/editor handling.

**Acceptance:** CLI editor cases in `test/plugins/specsCli.test.ts:27` retain behavior; TUI and hook compile fixtures cannot call the method. No need to spawn an editor just to test absence from a type.

**Dependencies/ownership:** WP04 capability type, WP06 env wiring, WP08 Specs call. Overlap DX-17; avoid competing context rewrites.

### <a id="dx-22"></a>DX-22 — Pending-file reads and stored-file reads look similar; JSON convenience is optional

**Severity:** minor. **Class:** useful documentation, optional abstraction. **Evidence:** confirmed two read contracts; JSON repetition limited to Epics.

**Locations:** `src/services/plugins/types.ts:123`, `:233`; `src/services/plugins/changeSet.ts:145`, `:278`; `src/plugins/epics/service.ts:11`, `:40`, `:52`, `:60`; `src/plugins/specs/index.ts:36`.

**Author problem:** `plugin.files.read` reads stored content; `changes.readFile` reads pending content first. Choosing the former inside a transform/guard can miss a write from the same operation. Epics manually implements JSON parsing, schema checking, missing-file error, ID/filename consistency, and formatting; Markdown plugins do not share that JSON pattern.

**Recommendation:** Clearly document stored-versus-pending reads with one example. Keep `FileScope` as-is. Only if demand warrants, add JSON methods preserving the two semantics:

```ts
readJson<T>(scope:FileScope,name:string,schema:z.ZodType<T>):Promise<T|null>;
writeJson(scope:FileScope,name:string,value:unknown):Promise<void>; // pending writer only
```

Return null only for a missing file; malformed JSON/schema violations need an attributed data-integrity error carrying scope/name. ID/filename consistency remains domain-specific. Do not rename every existing file method merely for cosmetic symmetry. WP02's logical-scope/transaction work takes precedence over extracting a facade.

**Acceptance:** Pending JSON reads see staged writes/deletes; missing and malformed are distinct; deterministic formatting; plugin-relative traversal remains rejected. No accidental reliance on a host-wide last-write cache.

**Dependencies/ownership:** WP02 transaction-aware file contract, WP04 API, WP08 Epics adoption. Deferred until integrity work lands; overlaps logical file scopes in other reports.

### <a id="dx-23"></a>DX-23 — Commander actions repeatedly forward the trailing Command into `cli.run`

**Severity:** minor. **Class:** useful improvement; action/text helpers optional. **Evidence:** confirmed repetition.

**Locations:** `src/services/plugins/types.ts:294`; `src/plugins/epics/commands.ts:6`, `:12`, `:33`, `:46`; `src/plugins/specs/commands.ts:13`, `:37`; `src/plugins/comments/commands.ts:13`, `:19`, `:34`, `:54`.

**Author problem:** A plugin-owned verb needs Commander positional/opts/Command knowledge and forwards the final `cmd` to a wrapper to obtain Rowbly behavior. Repeated type annotations use `NonNullable<PluginDefinition['commands']>`. This is reasonable for complex commands, but a beginner needs a copyable pattern.

**Recommendation:** Export `PluginCommands<S = Record<string,unknown>> = NonNullable<PluginDefinition<S>['commands']>` now. Document correct action ordering. An optional helper can bind to a concrete command rather than rely on tuple inference across Commander:

```ts
cli.action(command, async (env, args, options) => { /* ... */ });
```

If added, specify positional parsing and option typing precisely and retain `cli.run` as the escape hatch. A separate long-text helper must permit Specs' `--file` naming as well as `--body-file`; the existing three built-ins do not all use one identical flag triple. Keep the two-line wrapper if the new helper does not make a complete example simpler.

**Acceptance:** Zero/one/two positional args plus options invoke the right values; global JSON, board resolution, confirmation, warnings and exit behavior match `cli.run`; no async action is dropped. Alias-only work needs compile validation, not runtime mirror tests.

**Dependencies/ownership:** WP04 alias/API, WP06 CLI adapter, WP08 commands. Coordinate DX-11/12/33. Optional helper is not part of P0/P1.

### <a id="dx-24"></a>DX-24 — Screen params are untyped and reserve routing/breadcrumb keys

**Severity:** minor. **Class:** useful improvement; typed screen registry optional. **Evidence:** confirmed.

**Locations:** `src/services/plugins/types.ts:376`, `:421`; `src/tui/hooks/plugins.ts:30`, `:33`; `src/tui/screens/plugins/PluginScreen.tsx:10`, `:22`; `src/tui/router/index.tsx:52`; `src/plugins/specs/SpecDetailScreen.tsx:7`; `src/plugins/comments/CommentFormScreen.tsx:7`; `src/plugins/epics/EpicDetail.tsx:18`.

**Author problem:** `ui.open('detail',params)` cannot check params, and examples cast `Record<string,unknown>` into domain types. `params.title` controls the breadcrumb; `plugin` and `screen` are overwritten by routing and stripped before reaching the component. An author whose domain params include those keys loses data silently. The fallback title is the screen name, not a plugin-provided dynamic title.

**Recommendation:** Document reserved `plugin`/`screen`/`title` semantics. Validate domain params with a local schema at each built-in screen boundary; add `PluginScreenProps<S = Record<string,unknown>, P = Record<string,unknown>>` only if it can be used honestly with the host registry. A future screen definition `{ component, params:ZodType<P>, title? }` may centralize validation, but do not introduce a typed route DSL solely to save casts. Prefer separate routing metadata from domain params if the router is already being revised.

**Acceptance:** Missing/invalid ID gives a plugin-attributed validation display rather than `String(undefined)` lookup; malformed SpecTarget cannot silently select the wrong scope; breadcrumb remains correct; reserved-key collisions are documented or structurally impossible. Core navigation helper requested by WP05 should remain a distinct contract from own-plugin `ui.open`.

**Dependencies/ownership:** WP05 screen boundary, WP04 prop type, WP08 local validations, WP09 docs. Typed registry deferred/optional per supervisor; conflicts with router changes from other reviewers.

### <a id="dx-25"></a>DX-25 — Returning from a child screen requires an undocumented reload idiom

**Severity:** minor. **Class:** useful improvement; hook export optional. **Evidence:** confirmed repeated pattern.

**Locations:** `src/plugins/epics/EpicList.tsx:21`; `src/plugins/epics/EpicDetail.tsx:20`; `src/plugins/specs/SpecsScreen.tsx:26`; `src/plugins/specs/SpecTab.tsx:17`; `src/plugins/comments/CommentsTab.tsx:29`; `src/tui/screens/stories/shared.tsx:18`; `src/plugin-api/tui.ts:25`.

**Author problem:** Parent plugin screens remain mounted while forms are pushed; authors include `active` in `useAsync` dependencies so data refreshes on return. That also reruns on becoming inactive. Core has a reload-on-return hook, but it is located in Story screens and not exported by the plugin API.

**Recommendation:** Document the pattern first. If exporting a helper, move it into `src/tui/hooks/useReloadOnReturn.ts`, export through `hooks/index.ts` and `plugin-api/tui.ts`, and preserve its transition-only behavior. Allow an explicit active argument if tabs/components need a more specific signal; do not copy a screen-specific helper into the public API with no lifecycle explanation.

**Acceptance:** One reload on false→true return, none on initial mount or blur; latest data appears after child edit. Unmount/remount and tab visibility work without duplicate queries; existing `useAsync` cancellation of stale results still applies.

**Dependencies/ownership:** WP05 hooks with WP08 callers; overlaps DX-06/13/27 exports. Optional helper must follow AGENTS.md barrel rules.

### <a id="dx-26"></a>DX-26 — Async confirmation flows repeat, but are not identical

**Severity:** nit. **Class:** optional abstraction. **Evidence:** confirmed repetition; helper payoff inferred.

**Locations:** `src/plugins/epics/EpicDetail.tsx:21`, `:46`, `:92`; `src/plugins/specs/SpecDetailScreen.tsx:10`, `:24`, `:39`; `src/plugins/specs/SpecTab.tsx:8`, `:34`, `:48`; `src/plugins/comments/CommentsTab.tsx:26`, `:62`, `:104`.

**Author problem:** Delete flows each track confirming/busy, try/catch, refresh/back, and dialog callbacks. Only EpicDetail explicitly uses `useKeyCapture` here; some dialogs replace the screen and others render inline, so the original “copied four times” description was too strong.

**Recommendation:** Publish one reliable recipe; optionally extract a small `useAsyncConfirmation` controller returning `{ confirming,busy,ask,cancel,confirm }` with rejection/error handling. Keep `<ConfirmDialog>` in the component's own JSX so messages/layout/success effects stay explicit. Do not create a hook that manufactures a React component merely to hide state, or a generalized mutation framework.

**Acceptance:** Repeated confirm cannot start duplicate deletion; cancel is blocked/defined while busy; errors reset the dialog as documented; Escape cannot unexpectedly pop the underlying screen; successful delete refreshes or navigates once.

**Dependencies/ownership:** WP05 common hook if accepted; WP08 local call sites. Dependent on final lifecycle/error behavior WP01, and optional under consolidated scope guard.

### <a id="dx-27"></a>DX-27 — Async load/error presentation is repetitive and sometimes misleading

**Severity:** minor for incorrect empty/error labels; nit for helper duplication. **Class:** useful local polish; generic component optional. **Evidence:** confirmed.

**Locations:** `src/plugins/epics/EpicList.tsx:34`; `src/plugins/epics/EpicForm.tsx:12`; `src/plugins/specs/SpecDetailScreen.tsx:37`; `src/plugins/specs/SpecFormScreen.tsx:12`; `src/plugins/specs/SpecsScreen.tsx:42`; `src/plugins/comments/CommentsTab.tsx:76`; `src/tui/hooks/useAsync.ts:33`.

**Author problem:** Common loading/error branches are repeated, but some show a failure as “No Comments,” return null, or later look empty. `useAsync` already toasts errors, so it is incorrect to claim complete error silence. A valid `null` for create forms differs from absent `undefined` load results; a generic truthiness gate would break that distinction.

**Recommendation:** Correct local error-vs-empty displays in WP08. A shared `<AsyncState>` is optional only after testing null/empty-array/loading-refresh semantics; it should not duplicate existing toasts or conceal the actual error. Keep normal short conditionals when they are clear.

**Acceptance:** Failed comment read shows a failure, not an empty healthy Thread; empty comments are still healthy; create forms with `data:null` render; errors do not toast twice; refresh does not unnecessarily destroy user input.

**Dependencies/ownership:** WP08 local UI, WP05 if a component is accepted. New components get separate PascalCase files/barrels; no broad API addition required.

### <a id="dx-28"></a>DX-28 — Hints and key handlers must be kept in sync, with correct active state

**Severity:** nit. **Class:** useful recipe; optional abstraction. **Evidence:** confirmed parallel declarations; divergence risk inferred.

**Locations:** `src/plugins/epics/EpicList.tsx:22`, `:27`; `src/plugins/epics/EpicDetail.tsx:24`, `:60`; `src/plugins/specs/SpecsScreen.tsx:27`, `:35`; `src/plugins/comments/CommentsTab.tsx:35`, `:50`; `src/tui/hooks/shell.ts:127`.

**Author problem:** Key hints are strings (`y/n`, `tab/←/→`) while input handling works on actual input and Ink key objects. Active/confirm/busy state affects both. Authors must understand `useIsActive`, `useInput({isActive})`, and capture of shell keys. A hint is not always a one-to-one executable binding.

**Recommendation:** Add a small screen recipe showing matched gating for hints/input/capture. If a `usePluginKeys` helper is later justified, accept explicit executable bindings and separate display hints; do not pretend composite hint strings are keys. Preserve arrow/modifier handling and text-input capture rather than a dictionary of single characters only.

**Acceptance:** Inactive/covered screens cannot handle keys or replace visible hints; confirmation/modal/text controls get intended keys; shell navigation works after capture releases. No loss of composite hints or modifier support.

**Dependencies/ownership:** WP05 shell/hooks with WP08 adoption; overlaps action reservation in WP06 and DX-30/32. Optional helper, no blanket rewrite.

### <a id="dx-29"></a>DX-29 — Doctor checks spell storage paths and need contextual literal types

**Severity:** nit. **Class:** useful small export; finding builder optional. **Evidence:** confirmed duplicated paths; casts are not universally required.

**Locations:** `src/plugins/epics/index.ts:70`, `:71`; `src/plugins/specs/index.ts:96`, `:105`, `:106`; `test/plugins/fixtures/notes.ts:132`, `:133`; `src/services/plugins/types.ts:348`.

**Author problem:** Authors reconstruct `boards/<board>/stories/<key>/story.json`. Some mapped literals need `severity:'warning' as const`; Specs' explicitly typed `PluginFinding[]` needs no cast. A path helper alone cannot solve the supervisor's separate duplicate-key identity bug.

**Recommendation:** Export a safe root-relative `storyPath({boardId,key})`/`boardPath(id)` formatter if storage layout is an intentional public contract, or accept an explicit finding target and let doctor resolve its path. Use `satisfies PluginFinding`/typed arrays rather than a builder merely to avoid a cast. Stable physical-record identity for fix targeting remains WP03's responsibility, not a helper's.

**Acceptance:** Path formatting agrees with storage layout and naming rules; duplicate-key fixtures still target the intended record through WP03's identity-safe mechanism. Type-only literal fixes require compile verification, not extra runtime tests.

**Dependencies/ownership:** WP03 doctor contract, WP04 exports, WP08 checks. Conflict with WP02 identity/path changes; do not publish layout shortcuts before that contract settles.

### <a id="dx-30"></a>DX-30 — An Action's target does not narrow the focus type

**Severity:** minor. **Class:** useful type improvement. **Evidence:** confirmed type mismatch; runtime invariants need precise specification.

**Locations:** `src/services/plugins/types.ts:369`, `:386`; `src/tui/shell/Shell.tsx:60`, `:67`; `test/plugins/fixtures/notes.ts:147`; `src/tui/screens/tasks/TaskDetailScreen.tsx:45`.

**Author problem:** `target:'story'` is executed only when Story focus exists, but `run` still receives `story?:Story`, forcing optional checks. A task action is checked by task presence; requiring both Story and Task in a type without checking runtime would overclaim.

**Recommendation:** Use a discriminated Action union with target-specific `run` args: Story requires Story, Board requires Board, Task requires Task (and Story only if shell focus contract is made/enforced), none receives optional focus. Keep focus/current-active validation at dispatch time to avoid stale header callbacks acting on invalid records.

**Acceptance:** Story action can access `focus.story.key` without optional chaining; wrong target access fails compilation; task/none variants reflect actual guarantees; keyboard and header button dispatch follow the same validation.

**Dependencies/ownership:** WP04 types with WP05 shell; coordinate action key work WP06/DX-32. No packaging dependency.

### <a id="dx-31"></a>DX-31 — A failing field provider blocks the core form; skipping it must not send clear input

**Severity:** major. **Class:** P1 containment, with P0 preservation dependency. **Evidence:** confirmed propagation; impact supported by caller branches.

**Locations:** `src/tui/screens/stories/pluginFields.ts:26`, `:33`, `:56`, `:80`, `:84`; `src/tui/screens/stories/form.tsx:31`, `:36`; `src/tui/screens/stories/list.tsx:39`, `:96`; `src/services/plugins/service.ts:84`.

**Author problem:** Every provider is awaited in one collection loop with no per-plugin catch. A single failed Epic read can stop opening a Story form/filter, while rows already isolate failures per plugin. The caller's `useAsync` catches/toasts the error; “one try inside collect” in the earlier report was inaccurate. Simply skipping fields is unsafe because submission still iterates all plugins and can turn missing field values into clearing input.

**Recommendation:** Collect each provider through an attributed callback boundary, warning once and retaining a list of successful provider IDs/field descriptors. Submit only successful providers' fields and apply DX-09 dirty semantics. Exclude failed providers from filter conversion/description as well. Show a localized “plugin fields unavailable; stored data kept” message where appropriate, while allowing core editing and other plugins. Component rendering and async input callbacks need separate boundaries; row containment is not enough.

**Acceptance:** One throwing provider leaves core form and healthy fields usable; saving a core name preserves failed plugin data; failed filters do not silently produce destructive or narrowing values; diagnosis names plugin and provider stage. Reload can recover. Tests should include a failing provider that would otherwise emit `{x:null}` when values are absent.

**Dependencies/ownership:** WP05 collection/slots with WP01 callback invocation and WP04 field type. WP08 adapters must consume success/dirty state. Overlaps DX-09/39; implement as one coordinated change rather than catch-only patch.

### <a id="dx-32"></a>DX-32 — Reserved names are checked, but authors lack a preflight/reference

**Severity:** minor. **Class:** useful tooling; CLI checker optional. **Evidence:** confirmed.

**Locations:** `src/main.ts:38`; `src/services/plugins/host.ts:185`; `src/tui/keymap.ts:29`; `test/plugins/load.test.ts:78`; `src/commands/stories.ts:79`, `:105`, `:152` core `--label` options; `CONTEXT.md:35`.

**Author problem:** Failures are clear when a plugin activates, but no public tool lists reserved options/keys or validates a definition before enabling it. The exact original `--label` exercise collides with core on create/edit/list. Load-time rejection is correct; silently allowing duplicates would be a regression. `Label` is a core domain term, not a ban on naming a plugin `labels`.

**Recommendation:** Add `validatePluginDefinition` to the DX-15 harness or a small SDK validation entry backed by the same host validator. Report structured diagnostics including contribution path and reserved name. Generate a reference of supported core option commands/keys from current registration; do not maintain a second hardcoded list. Optional `plugins check <module>` must obey the same explicit evaluation/trust rules as DX-02. Check duplicate raw flags within one plugin while allowing legitimate positive/negative pairs; `claimNames` currently checks only the preexisting `taken` set during the map and does not reject internal duplicate flags.

**Acceptance:** A preflight with `--label` points to core's reservation before activation; duplicate raw flags/ambiguous attributes fail deterministically; valid pair succeeds; wrong command path/short flag gives a diagnostic. Docs list reserved namespaces without requiring the author to copy all host internals. See existing load clash tests at `test/plugins/load.test.ts:85`, `:126`.

**Dependencies/ownership:** WP06 host validator with WP04 exported diagnostics and WP07 harness. WP10 external CLI checker optional. Overlaps host/registration reviewers and DX-10.

### <a id="dx-33"></a>DX-33 — A few intentional type/helper exports would reduce deep-import temptation

**Severity:** nit. **Class:** useful export audit; unused exports may be deferred. **Evidence:** confirmed missing named exports, not proof every omission is a defect.

**Locations:** `src/plugin-api/index.ts:8`, `:20`, `:40`, `:91`; `src/services/plugins/host.ts:20`; `src/services/plugins/types.ts:325`; `src/plugins/epics/commands.ts:6`; `src/core/errors.ts:88`.

**Author problem:** The barrel reexports much of the contract, but not `Label`, `PluginStatus`, `DoctorFinding`, or `PluginError`. `PluginCommands` and `PluginOption` do not yet exist as named aliases. Authors can often infer these through method types, but explicit annotations encourage forbidden deep imports. Task change authors also have `parseStoryKey`/`isTaskId` without an exported `parseTaskId` helper.

**Recommendation:** Add `PluginCommands` and `PluginOption` aliases where currently repeated; export existing named types only when a public example or fixture needs them. Consider `parseTaskId` if task transforms use it instead of string splitting. `PluginError` is useful for harness/runtime diagnostics, not necessarily a beginner import; do not expose every internal class by default. Do not remove the existing `Services` export as a styling nit while public command contracts still refer to it.

**Acceptance:** A consumer compile fixture can annotate command/options, core-label use, and plugin status/finding output through approved entries with no internal imports. Emitted declarations do not leak inaccessible private modules after DX-02. An export inventory records deliberate omissions.

**Dependencies/ownership:** WP04 barrel/type editor; WP10 package artifacts; DX-23 aliases and DX-15 harness. Deferred unused exports need a disposition rather than speculative additions.

### <a id="dx-34"></a>DX-34 — Explicit `return undefined` in guards is not required (withdrawn)

**Severity:** nit in the original report; **current disposition:** withdrawn/no change. **Evidence:** confirmed compiler probe.

**Locations:** `src/services/plugins/types.ts:206`; `src/plugin-api/index.ts:98`; explicit returns in `src/plugins/specs/index.ts:32`, `:40`, `:60` are style, not proof of a requirement.

**Correction:** With current TypeScript 7.0.2, `definePlugin({ …, hooks:{'stories.create':{guard(){}}} })` compiles under strict settings. The optional change to accept `void` is unnecessary for this claimed trigger.

**Recommendation:** Keep the signature unless a different concrete use case proves a restriction. Retain this ID in the merged index as withdrawn.

**Acceptance:** The reproduced compile case below passes without an explicit return; no production signature change is needed.

**Dependencies/ownership:** WP04 records disposition; no implementation owner or source change needed. Do not open a PR just to add `void` based on the earlier report.

### <a id="dx-35"></a>DX-35 — Omitted settings schema is permissive; strictness should be an explicit author choice

**Severity:** nit. **Class:** useful documentation; implicit stripping/doctor framework rejected. **Evidence:** confirmed parse behavior.

**Locations:** `src/services/plugins/host.ts:143`, `:144`; `src/services/plugins/types.ts:486`; `docs/PLUGINS.md:192`; `src/plugins/epics/index.ts:29`; `src/plugins/specs/index.ts:18`; `src/plugins/comments/index.ts:6`.

**Author problem:** Epics declares `z.object({})`, Specs/Comments omit settings; omission passes raw settings through. Ordinary Zod object parsing strips unknown properties from the parsed view. That is not deletion of the stored configuration: `parseSettings` does not rewrite it. The inconsistent examples obscure the policy and can hide config typos in a parsed view.

**Recommendation:** Explain omission and Zod strip/strict choices. Show `z.strictObject({...})` for settings where typos should fail, and no settings key for a no-settings hello world. Reject the original blanket “parse every omitted schema as empty and doctor-report unknown settings” proposal; it changes behavior and needs a real requirement. Preserve unknown settings in storage for off/unknown/future plugins.

**Acceptance:** A strict schema rejects a typo with a load reason; permissive omission retains its documented behavior; parsing never silently rewrites stored config. No new doctor code or arbitrary default semantics needed.

**Dependencies/ownership:** WP09 docs and WP04 schema guidance, with WP06 diagnostics. Overlaps DX-04/06 and settings preservation in other reviewers' work.

### <a id="dx-36"></a>DX-36 — Misspelled operation names are accepted and silently never run

**Severity:** major for diagnostic quality. **Class:** useful validation/type improvement. **Evidence:** confirmed key type and runtime lookup; trivial reproduction is code-supported, not a suite test.

**Locations:** `src/services/plugins/types.ts:213`, `:215`; `src/services/plugins/runtime.ts:75`; `src/services/plugins/host.ts:185`; `docs/PLUGINS.md:169`.

**Author problem:** The hook map allows arbitrary `string & {}` to support another plugin's operations. A beginner can use CLI vocabulary `'stories.edit'` instead of service operation `'stories.update'`; the type accepts it, activation succeeds, and the handler is never called. Commands also use delete/edit while core operations use remove/update, making this a plausible mistake.

**Recommendation:** Separate known core operations from explicit plugin-qualified names: e.g. `hooks` with core keys plus a typed escape hatch `pluginHooks` or template `` `${string}.${string}` `` coupled with load validation that rejects **unknown names in reserved core namespaces**. The template alone does not reject `stories.edit`. Validate reserved core service names against `CoreOperations`; allow unresolved custom plugin hooks by design without imposing a dependency graph. Include near-name hints (`stories.edit → stories.update`, delete → remove).

**Acceptance:** Misspelled core operation fails preflight/activation with an actionable suggestion; `'notes.add'` still works; an unknown custom namespace is documented as untyped rather than falsely guaranteed. Compiler fixtures protect known operation input/result typing.

**Dependencies/ownership:** WP04 types plus WP06 definition validator; WP09 name table. No plugin dependency graph required. Conflicts with other operation naming/type work; route all edits through WP04.

### <a id="dx-37"></a>DX-37 — Generic bag writing on root settings can drop activation

**Severity:** minor. **Class:** useful contract clarification; narrowed settings writes. **Evidence:** confirmed code path; hypothetical misuse not integration-tested here.

**Locations:** `src/services/plugins/types.ts:247`, `:250`, `:472`; `src/services/plugins/runtime.ts:191`; `docs/PLUGINS.md:215`; `src/services/plugins/host.ts:82`; `src/services/plugins/service.ts:41`.

**Author problem:** `writeBag(record,bag)` removes and replaces the entire namespace. The context table says “on any record,” but the Data Root's namespace is also settings/`enabled`. Applying `writeBag(config,{mySetting:…})` inside `changes.updateRootConfig` can discard `enabled` and other settings. Removing a Board settings bag is similarly different from removing a Story value.

**Recommendation:** State the root/Board settings distinction in JSDoc/docs. Keep `writeBag` for ordinary entity/plugin-data records, and give settings writes a deliberate API that preserves activation and uses schema/cascade rules, or document a safe merge recipe until needed. Avoid branding every Bagged record purely to prevent this case if phase-specific context already narrows allowed writes.

**Acceptance:** Updating a setting retains `enabled` and unrelated keys; Board overrides do not toggle root activation; removing a Story bag still removes just its namespace. A compile/example fixture illustrates the correct settings update, with no silent claim that `writeBag` is a patch.

**Dependencies/ownership:** WP04 settings/bag contract with WP06 configuration and WP02 writes. Overlap consolidated WP04 “settings separate from general bags.”

### <a id="dx-38"></a>DX-38 — Plugin-owned record updates need an explicit timestamp convention

**Severity:** minor. **Class:** useful built-in consistency/docs. **Evidence:** confirmed inconsistent paths; not a claim about ordinary core edits.

**Locations:** `src/services/stories.ts:192`; `src/services/plugins/changeSet.ts:73`; `src/plugins/specs/specs.ts:114`, `:128`; `src/plugins/specs/index.ts:109`; `src/plugins/epics/service.ts:78`; `src/plugins/comments/comments.ts:88`.

**Author problem:** Core create/edit already timestamps Stories; `changes.updateStory` does not automatically change metadata. Epics/Comments timestamp their own data changes, while Specs unlink-on-delete and doctor repairs do not. A plugin author copying either example learns a different rule.

**Recommendation:** Document that Change Set mutation validates records but does not synthesize metadata. Fix Specs' own unlink/doctor paths to use the agreed Story timestamp rule. If the architecture chooses host-managed timestamps, implement it once with semantics for no-op transformations, Tasks, doctor, and deterministic clocks; do not add a blind bump to every convenience helper.

**Acceptance:** Core plugin-input edits update timestamps exactly once per operation clock policy; unlinking a Board Spec and doctor repairs update affected Stories deliberately; unmodified Stories do not change; Task and Story Comment timestamps remain consistent. Use existing controllable clock fixtures.

**Dependencies/ownership:** WP08 Specs with WP03 doctor and WP04 metadata contract. Avoid altering generic Change Set semantics independently of WP02. This retains the valid portion of DX-01's earlier timestamp claim.

### <a id="dx-39"></a>DX-39 — Non-hook callbacks lack uniform plugin/stage error attribution

**Severity:** minor (containment implementation is P1). **Class:** reliability/diagnostic improvement. **Evidence:** confirmed call sites.

**Locations:** `src/commands/_shared.ts:74`; `src/services/stories.ts:271`; `src/tui/screens/stories/pluginFields.ts:56`, `:80`, `:87`; `src/tui/components/PluginSlot.tsx:16`; `src/tui/screens/plugins/PluginScreen.tsx:22`; `src/services/plugins/runtime.ts:149`.

**Author problem:** Hooks have plugin/operation/stage attribution, but option conversion and `filterStories` are invoked directly; TUI conversion and summary callbacks also invoke directly. A thrown `UsageError` from CLI conversion retains its usual code but no automatic `details.plugin`; unexpected exceptions can be hard to associate with the contributing plugin. React render errors do not go through hook wrapping at all.

**Recommendation:** Reuse WP01's callback invocation adapter at host-controlled option/filter/form/summary boundaries, preserving expected errors and adding plugin/contribution stage. Use WP05 render boundaries for components, separately from asynchronous callback handling. Do not catch filter bugs and silently return true/false: a list should fail visibly rather than lie about its result.

**Acceptance:** Throw from each callback kind and verify plugin/stage attribution, expected code, and appropriate containment. A filter exception is not mislabeled empty results; field/render exceptions leave core navigation usable; no double warnings/toasts. CLI JSON error retains parseable shape.

**Dependencies/ownership:** WP01 adapter, WP06 CLI, WP05 TUI, WP04 filter validation. Overlap DX-07/31 and other reviewers' error-isolation findings; one adapter, several consumers.

## Repeated patterns: Epics, Specs, Comments, and the fixture

The table records all repeated patterns identified in the recovered review, with corrections. **E** = `src/plugins/epics/`, **S** = `src/plugins/specs/`, **C** = `src/plugins/comments/`, **N** = `test/plugins/fixtures/`. A dash means the pattern is not present; it is not missing functionality. Repetition of a short ordinary React/Commander pattern alone does not force extraction.

| Pattern | Epics evidence | Specs evidence | Comments evidence / fixture | Disposition |
| --- | --- | --- | --- | --- |
| Shared apply-input helper and lookup of created Story | E `index.ts:6,35` | S `specs.ts:143`, `index.ts:27` | C —; N `notes.ts:26,46` | DX-07/08; DX-01 optional |
| Same value applied on core create/update | E `index.ts:33,41` | S `index.ts:25,43` | C —; N `notes.ts:44,60` | Recipe first; optional field helper |
| Core create/edit/list option adapters | E `index.ts:46` | S `index.ts:71` | C —; N `notes.ts:66` | DX-10/11/12 |
| Absence checks in converter | E `index.ts:49,53` | S `index.ts:15,82` | N `notes.ts:69,76,80` | Shared parsing where exact semantics align |
| Parse bag then read one property | E `service.ts:65` | S `specs.ts:110` | C `comments.ts:31` | Keep local accessor; DX-09 invalid-state distinction |
| Remove bag when empty | E `index.ts:9` | S `specs.ts:115` | C `comments.ts:91`; N `notes.ts:22` | Deliberate simple pattern; preserve opaque bags |
| Own operation updates record metadata | E `service.ts:78` | S bulk unlink/doctor lack bump | C `comments.ts:88` | DX-38; not a core-edit timestamp failure |
| Story rows | E `index.ts:58` | S — | C `index.ts:12`; N `notes.ts:84` | Already simple |
| Manual input validation | E `model.ts:22` | S `specs.ts:145` | C body validation `comments.ts:111`; N silent ignore `notes.ts:32` | DX-07; distinguish hook vs operation body |
| JSON parse/schema/stringify | E `service.ts:15,40,52,60` | Markdown, not JSON | C bag, not file | Optional DX-22; not repeated by all three |
| Lazy TUI named-export unwrap | E `index.ts:84` | S `index.ts:123` | C `index.ts:18`; N `notes.ts:150` | DX-13 nit |
| Repeated standalone settings generic | E `tui.ts:7`, `EpicDetail.tsx:17` | S `tui.ts:9`, `SpecsScreen.tsx:15` | C `tui.ts:5`, `CommentFormScreen.tsx:6` | DX-06 defaults; inference works |
| Reload via active in async dependencies | E `EpicList.tsx:21`, `EpicDetail.tsx:20` | S `SpecsScreen.tsx:26`, `SpecTab.tsx:17` | C `CommentsTab.tsx:30` | DX-25 recipe/helper optional |
| Confirm/busy/async delete flow | E `EpicDetail.tsx:21,46,92` | S `SpecDetailScreen.tsx:10,24,39`, `SpecTab.tsx:34` | C `CommentsTab.tsx:26,62,104` | DX-26 optional; capture/reset differ |
| Loading and error branches | E `EpicList.tsx:34`, `EpicForm.tsx:12` | S `SpecDetailScreen.tsx:37`, `SpecsScreen.tsx:42` | C `CommentsTab.tsx:76`, `CommentFormScreen.tsx:12` | DX-27 local messages; generic wrapper optional |
| Separate hints and key handlers | E `EpicList.tsx:22,27` | S `SpecsScreen.tsx:27,35` | C `CommentsTab.tsx:35,50` | DX-28 optional |
| Param coercion and routing titles | E `EpicDetail.tsx:18`, `EpicList.tsx:46` | S `SpecDetailScreen.tsx:7` | C `CommentFormScreen.tsx:7`, `CommentsTab.tsx:54` | DX-24 local validation first |
| Own form submit, toast, then back | E `EpicForm.tsx:22` | S `SpecFormScreen.tsx:22` | C `CommentFormScreen.tsx:16` | Keep; small meaningful sequence |
| Extracted commands type | E `commands.ts:6` | S `commands.ts:13` | C `commands.ts:13` | DX-23/33 alias |
| Long-text options and reading | E `commands.ts:30,36` | S `commands.ts:33,56` | C `commands.ts:54,62` | DX-23 optional; flag names/editor paths differ |
| Commander action forwards trailing command to cli.run | E `commands.ts:12,33,46,75,91,100` | S `commands.ts:18,37` | C `commands.ts:19,26,34,45` | DX-23 recipe/helper optional |
| Fetch, CLI confirm, delete | E `commands.ts:102` | S `commands.ts:44` | C `commands.ts:47` | Keep; three explicit steps |
| Own operation body plus Change Set and warning after save | E `service.ts:74,85` | S `specs.ts:121,139` | C `comments.ts:47,60,76` (no unlink warning) | Keep pipeline convention; teach body vs hook errors |

The **TUI is harder for a component plugin**, because authors must manage React state, async loading, focus, capture, hints, dialogs, routing params, and stale parent data. No measured “twice as hard” ratio is established. A metadata-only field plugin does not require React components or the TUI import at all. Existing `Form`, `SelectList`, `useAsync`, `useIsActive`, and `PluginUi` already reduce much of the work; precise examples and correct preservation/failure contracts should precede helper families.

## Concrete exercise: hello world and a realistic Story field

### Today's actual hello world

```ts
import { definePlugin } from '../../plugin-api';
export const hello = definePlugin({
  id: 'hello', name: 'Hello', description: 'Shows the Story Key',
  storyRows: async (story) => [{ label: 'Hello', value: story.key }],
});
```

Five physical code lines, one TypeScript file, three immediate ideas: definition identity, required metadata, row contribution. Built-in registry/enablement/import/glossary steps are additional integration concepts, as documented in DX-05. Halving this declaration would mostly compress formatting; there is no reason to obscure it with another abstraction.

### Why the realistic exercise uses Points

The requested shape was a Labels-like plugin: a Story bag, create/edit CLI option, filter, row, and TUI form field. Core already owns `--label` on those commands; the installed-source `reservedNames` probe below confirms it. A literal plugin contributing that flag fails correctly at load. A separate bag called `labels` with a different flag such as `--extra-label` could work, but would duplicate Rowbly's existing Label feature. **Points** demonstrates the same extension shape with no namespace collision, and tests zero/empty handling that a string-only example would conceal.

### Before: against today's API, in one file

The following belongs at hypothetical `src/plugins/points/index.ts`; it is printed here only. It uses the existing inline async `tui` factory and source API path. No `model.ts` or separate `tui.ts` is forced. It supports create/set, edit/set/clear, exact-value list filtering, list filtering for unset, a shared CLI/TUI row, a number form field, and numeric TUI filtering. TUI “any” is empty; CLI additionally supports “unset” with `--no-points`.

<!-- example: points-before -->
```ts
import { definePlugin, type PluginChangeSet, type PluginContext, ValidationError, z } from '../../plugin-api';

const Value = z.number().int().min(0);
const Bag = z.object({ points: Value });
const Payload = z.object({ points: Value.nullable() });
function payload(value: unknown) {
  const parsed = Payload.safeParse(value);
  if (!parsed.success) throw new ValidationError('Invalid Points input', { details: { issues: parsed.error.issues } });
  return parsed.data;
}
function cliInput(value: unknown) {
  if (value === undefined) return undefined;
  if (value === false) return { points: null };
  if (typeof value !== 'string' || !/^\d+$/.test(value)) throw new ValidationError('--points needs a nonnegative integer');
  return payload({ points: Number(value) });
}
async function apply(changes: PluginChangeSet, key: string, input: unknown, plugin: PluginContext) {
  if (input === undefined) return;
  const { points } = payload(input);
  await changes.updateStory(key, (story) => plugin.writeBag(story, points === null ? undefined : { points }));
}
const positive = { flags: '--points <n>', description: 'the Story point estimate' };
const negative = { flags: '--no-points', description: 'without an estimate' };

export const points = definePlugin({
  id: 'points', name: 'Points', description: 'Story point estimates',
  bags: { story: Bag },
  hooks: {
    'stories.create': {
      async transform({ changes, pluginInput, plugin }) {
        const created = changes.changes.find((c) => c.type === 'story' && c.before === null);
        if (created?.type === 'story' && created.after) await apply(changes, created.after.key, pluginInput, plugin);
      },
    },
    'stories.update': {
      transform: ({ changes, input, pluginInput, plugin }) => apply(changes, input.key, pluginInput, plugin),
    },
  },
  options: {
    'stories create': { options: [positive], input: ({ points }) => cliInput(points) },
    'stories edit': { options: [positive, negative], input: ({ points }) => cliInput(points) },
    'stories list': { options: [positive, negative], input: ({ points }) => cliInput(points) },
  },
  filterStories: (story, filter, plugin) => (plugin.readBag(story, Bag)?.points ?? null) === payload(filter).points,
  storyRows: async (story, plugin) => [{ label: 'Points', value: String(plugin.readBag(story, Bag)?.points ?? 'none') }],
  tui: async () => ({
    storyForm: {
      fields: async ({ story, plugin }) => [{
        name: 'points', label: 'Points', kind: 'number',
        value: story ? (plugin.readBag(story, Bag)?.points ?? null) : null,
      }],
      input(values, story) {
        const stored = Bag.safeParse(story?.plugins?.points);
        const before = stored.success ? stored.data.points : null;
        const after = typeof values.points === 'number' ? values.points : null;
        return before === after ? undefined : { points: after };
      },
    },
    storyFilter: {
      fields: async () => [{ name: 'points', label: 'Points', kind: 'number' }],
      filter: (values) => typeof values.points === 'number' ? { points: values.points } : undefined,
      describe: (values) => typeof values.points === 'number' ? `Points: ${values.points}` : '',
    },
  }),
});
```

**Count:** 65 physical lines, 63 nonblank lines, one TypeScript file. Built-in integration adds a glossary file, registry import/array entry, map link, and enabling configuration; those are not smuggled into the code-line count. In an external package the future packaging/loader replaces those repository edits rather than pretending they disappear automatically.

**Concept count:** 16 explicitly counted concepts, plus built-in integration: (1) identity/metadata; (2) Zod bag schema; (3) separate mutation payload; (4) runtime validation and expected errors; (5) transform phase; (6) service operation names; (7) pending Change Set and created-subject lookup; (8) own-bag read/write/remove; (9) core-command contribution names; (10) raw Commander attributes/absence; (11) paired negation/false-to-clear; (12) list criteria/matcher; (13) rows; (14) async TUI factory; (15) form values, initial values, and edit-clear/unchanged conversion; (16) filter fields/conversion/summary. “Concept” is this enumerated review checklist, not an objective cognitive metric. React components, screen routing, guards, replacements, files, and doctor are not necessary to write this example.

**Limits of the current example:** Hook validation still gets wrapped as INTERNAL under today's runtime; number validation beyond finite-number Form parsing is not mapped inline. Filtering treats invalid bags as unset because `readBag` does. The unchanged-value comparison avoids clearing an invalid bag merely by saving a name, but cannot detect a user's explicit attempt to reset an already displayed empty invalid value. It is not a substitute for WP05's dirty/invalid-state contract. A transform still scans for the first created Story. These are real limitations of today's API, not hidden omissions from the proposed helper.

### After: optional bounded helper, not a mandatory DSL

This is **proposed syntax**, requiring DX-01 and future public exports. It is not claimed to exist or compile against today's Rowbly:

<!-- example: points-after -->
```ts
import { defineStoryFieldPlugin, ValidationError, z } from 'rowbly/plugin';

export default defineStoryFieldPlugin({
  id: 'points', name: 'Points', description: 'Story point estimates',
  field: {
    name: 'points', label: 'Points', kind: 'number', empty: null,
    schema: z.number().int().min(0),
    cliValue(raw) {
      if (!/^\d+$/.test(raw)) throw new ValidationError('--points needs a nonnegative integer');
      return Number(raw);
    },
    format: String,
  },
});
```

**Count:** 14 physical lines, 13 nonblank lines, one TypeScript file; five explicit concepts: metadata, one Story field, value schema, CLI parsing, display format. Strict CLI parsing is retained instead of hiding coercion (`Number('')` and `Number(null)` are both zero). The helper implements the shared glue using the final WP04/WP05 contracts; it does not introduce a second persistence pipeline. This is less than half the baseline code, but relocates complexity into tested library code. The user still learns Rowbly integration/compatibility and the semantics of clearing/filtering.

| Comparison | Code lines (physical/nonblank) | TypeScript files | Explicit author concepts | Status |
| --- | --- | --- | --- | --- |
| Display hello world | 5 / 5 | 1 | 3 + integration | Already possible |
| Points, current low-level API | 65 / 63 | 1 | 16 + integration | Compile-probed only; behavioral suite not run |
| Points, bounded helper | 14 / 13 | 1 | 5 + integration | Optional proposal |

**Required parity test matrix if the helper is implemented:**

| Trigger | Expected behavior |
| --- | --- |
| Create with no flag/empty form | No Points bag; no implicit default input |
| Create/edit with `0` | `{points:{points:0}}` bag; row “0”; exact filter matches |
| Edit unrelated core value | Points data, including invalid/future data, preserved unless explicitly edited |
| Clear nonempty field / `--no-points` | Remove only the Points namespace; other plugin data kept |
| List `--points 3` | Only matching Stories; criteria parsed once before scanning |
| List `--no-points` | Explicit unset predicate; do not silently claim invalid data is validated absence |
| TUI filter `3`, empty | Same numeric match; empty means no Points criterion |
| Invalid integer/value payload | Attributed validation, no saved mutation, useful inline error where applicable |
| Another plugin rejects guard | Neither core nor Points changes saved |
| Two new records in operation | Target the actual subject, not first-created scan |
| CLI invocation | No React/Ink component module evaluated |

The targeted fixes DX-07/08/09/10/13 improve this example without requiring DX-01. There is no verified claim that those fixes alone cut it to the earlier report's “38 lines”; that sample used undeclared types and mixed incompatible callback shapes. Re-measure a complete compiling example after the agreed primitives land before approving a helper.

## Parallel ownership and supervisor conflict check

The supervisor's `docs/reviews/plugin-architecture/README.md` was read for conflict checking only and not edited. Its consolidated decisions and work packages are the execution authority. Generic owner names in the findings map to these packages; consumers coordinate with the named shared-file owner:

| Package | DX ownership / consumers | Coordination |
| --- | --- | --- |
| WP01 runtime safety/errors | DX-17, 19, 39; runtime side of DX-07/08/18 | WP04 edits types; WP02 owns storage and sealing/commit |
| WP02 storage | DX-22 pending-file behavior, DX-29 paths/identities | No helper should preempt transaction/logical scope work |
| WP03 doctor | DX-29, doctor part of DX-38 | WP08 plugin-specific checks; identity fix is separate from formatting |
| WP04 API/types | DX-06–12, 18, 20–24, 30, 33–37; optional DX-01 | Sole shared types/barrel editor; collect signatures from consumers |
| WP05 TUI | DX-09, 20, 24–28, 31; TUI side of DX-39 | Data preservation before convenience; coordinate Form, router, field adapters |
| WP06 host/CLI | DX-10–13, 23, 32, 36; CLI attribution | One definition validator and staged attachment mechanism |
| WP07 tests/harness | DX-15, preflight DX-32; compile probes | WP10 public artifacts; do not export all internal test setup |
| WP08 built-ins | Repeat-pattern table; DX-21/24/27/38 call sites | Individual plugin ownership after contracts land; no competing public helpers |
| WP09 docs | DX-03–05, 09–13, 17–19, 21–25, 32, 35–38 | Reference implemented final behavior; tutorial compile check |
| WP10 external readiness | DX-02/14; public DX-15/33; optional DX-16 | Explicit loader/trust and version policy; separate release milestone |

**No material disagreement with the consolidated priority/order decisions.** Two cautions are narrower implementation boundaries, not requests to overturn the plan: per-operation payload schemas should allow different inputs across core operations instead of forcing one plugin-wide schema; version/data policy should be documented before assuming a generic migration engine is necessary for every plugin. A future explicit migration must use the coordinator and preserve recoverability, as the supervisor requires.

Rejected/deferred recommendations retained here: mandatory universal `storyFields` expansion; automatic precedence/merge of generated and hand-written definitions; making built-in glossaries optional to shorten an example; a prescribed `trustedPlugins` configuration not specified by ADRs; mandatory `core()` in a replacement; arbitrary deletion of command service capabilities; blanket settings stripping/unknown-key doctor framework; unneeded `void` guard signature; immediate typed screen/operation/helper DSLs; a broad in-process CLI stream refactor solely for harness convenience. They should not become implementation tasks through copying the original report.

## Reproducible evidence (no repository source writes)

These scripts were run as standalone probes, not Vitest tests. Keep them in this report to satisfy the one-assigned-file constraint. They require existing dependencies and leave compiler scratch files only under `/tmp`.

### Settings inference and implicit guard return

```sh
node --input-type=module <<'NODE'
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const dir = mkdtempSync(join(tmpdir(), 'rowbly-plugin-dx-'));
const file = join(dir, 'probe.ts');
const api = join(process.cwd(), 'src/plugin-api/index');
writeFileSync(file, `import { definePlugin,z } from '${api}';
const p=definePlugin({id:'probe',name:'Probe',description:'Probe',
settings:z.object({marker:z.string().default('note')}),
start({settings}){const marker:string=settings.marker;},
storyRows:async (_story,plugin)=>[{label:'Probe',value:plugin.settings.marker}]});
const marker:string=p.settings!.parse({}).marker;
definePlugin({id:'guard-probe',name:'Probe',description:'Probe',
hooks:{'stories.create':{guard(){}}}});
`);
const result = spawnSync('node_modules/.bin/tsc', [
  '--ignoreConfig', '--noEmit', '--strict', '--target', 'ES2023',
  '--module', 'ESNext', '--moduleResolution', 'Bundler', '--jsx', 'react-jsx',
  '--esModuleInterop', '--resolveJsonModule', '--skipLibCheck', '--types', 'node',
  '--typeRoots', join(process.cwd(), 'node_modules/@types'), file,
], { encoding:'utf8' });
console.log('scratch file:', file);
console.log('compiler exit:', result.status);
console.log(result.stdout + result.stderr);
NODE
```

Observed: compiler exit 0, no diagnostics. Initial attempt to use the legacy `typescript` compiler API failed because this installed TS 7 package's default export does not expose `ts.sys`; the CLI probe above is the corrected reproduction. Initial CLI probe without `--types node` was corrected to include the explicit repository Node type selection; those environment setup diagnostics are not plugin findings.

### Negation defaults and the Labels collision

```sh
node --import tsx --input-type=module <<'NODE'
import { Command } from 'commander';
import { reservedNames } from './src/main.ts';
for (const paired of [false, true]) {
  const cmd = new Command().exitOverride();
  if (paired) cmd.option('--probe <value>', 'value');
  cmd.option('--no-probe', 'none');
  cmd.parse([], { from:'user' });
  console.log(paired ? 'paired' : 'negation-only', cmd.opts());
}
const reserved = reservedNames();
console.log(['stories create','stories edit','stories list']
  .map(path => [path, reserved.options[path].includes('label')]));
NODE
```

Observed: negation-only `{ probe:true }`; paired `{}`; `label` reserved is true for all three commands. This reproduces default values and reservation, not a full plugin activation test.

### Recount and compile the current Points example

```sh
node --input-type=module <<'NODE'
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
const report = readFileSync('docs/reviews/plugin-architecture/straightforwardness-for-plugin-authors.md','utf8');
function example(name) {
  const marker = '<!-- example: ' + name + ' -->';
  const tail = report.slice(report.indexOf(marker) + marker.length);
  return tail.match(/```ts\n([\s\S]*?)\n```/)[1];
}
for (const name of ['points-before','points-after']) {
  const lines = example(name).split('\n');
  console.log(name, { physical:lines.length, nonblank:lines.filter(line=>line.trim()).length });
}
const file = join(mkdtempSync(join(tmpdir(),'rowbly-plugin-points-')), 'points.ts');
const code = example('points-before').replace("'../../plugin-api'", JSON.stringify(join(process.cwd(),'src/plugin-api/index')));
writeFileSync(file, code);
const result = spawnSync('node_modules/.bin/tsc', [
  '--ignoreConfig','--noEmit','--strict','--target','ES2023','--module','ESNext',
  '--moduleResolution','Bundler','--jsx','react-jsx','--esModuleInterop',
  '--resolveJsonModule','--skipLibCheck','--types','node',
  '--typeRoots',join(process.cwd(),'node_modules/@types'),file,
], {encoding:'utf8'});
console.log('current example compiler exit:', result.status);
console.log(result.stdout + result.stderr);
NODE
```

Observed: before 65 physical/63 nonblank lines; after 14 physical/13 nonblank lines; current example compiler exit 0 with no diagnostics. The after example is counted but deliberately not compile-checked: its helper is a proposal. The current example compiler result verifies shape/types only, not save semantics or CLI/TUI behavior.

## Ranked top ten

This is an author-experience ranking constrained by the supervisor's integrity priorities, not a competing release roadmap.

1. **DX-09 + DX-31:** Preserve untouched invalid/future data and make failed field providers harmless before improving convenience.
2. **DX-17:** Enforce the write boundary and phase-specific immutable views; authors should not accidentally bypass guards.
3. **DX-07 + DX-39:** Type and validate payload/filter boundaries; retain expected error meaning and attribution.
4. **DX-03 + DX-04 + DX-05:** Runnable minimal guide with complete clearing/parsing examples and correct scope.
5. **DX-10 + DX-11:** Centralize absent/negated/repeatable parsing and document exact raw values.
6. **DX-08 + DX-36:** Expose the actual operation subject and catch misspelled core hooks early.
7. **DX-15 + DX-32:** A small reusable test/preflight harness, after a real package boundary exists.
8. **DX-02 + DX-14:** Supported exports, compatible installed definitions, and explicit trusted loading before the separate third-party launch.
9. **DX-21 + DX-24 + DX-25 + DX-27:** Correct CLI-only editor boundary, validated screen params, reload guidance, and honest error states.
10. **DX-06 + DX-23 + DX-33 + DX-35 + DX-37 + DX-38:** Small generic/export/settings/metadata improvements. DX-01/16/22/26/28 remain optional after measuring the resulting examples.

## Already straightforward: preserve these contracts

- `definePlugin` as a typed identity with only `id`, `name`, `description` required (`src/plugin-api/index.ts:97`; `types.ts:480`). Keep its working settings inference.
- Declarative optional contribution properties; a row-only or command-only plugin need not learn every extension point.
- Plugin IDs as slug/namespace/command roots, automatically injected by the host (`types.ts:482`; `runtime.ts:169`). No manual `plugins.<id>` read/write is necessary for normal entity bags.
- `readBag(record,schema)` and immutable-copy `writeBag(record,bag)` for supported data (`runtime.ts:185`). Add an inspection path for invalid/future preservation rather than breaking convenient supported reads indiscriminately.
- `PluginRow {label,value:string}` reused by CLI and TUI (`types.ts:334`). No rich render protocol is needed for plain rows.
- Guard `{reject,hint?}` and conflict attribution (`types.ts:202`; `runtime.ts:105`). Explicit rejection is easy to understand.
- One body/transform/guard/save/react order shared by services and surfaces (`runtime.ts:94`, `:97`, `:101`, `:114`, `:116`). Strengthen guarantees without creating another event/workflow engine.
- `plugin.operation('localName',input,body)` prefixes the plugin ID automatically (`runtime.ts:205`). Clarify unqualified local names in JSDoc; do not make authors repeat IDs.
- `FileScope = 'dataRoot' | {board} | {story}` (`types.ts:115`) and plugin-relative filenames. Logical pending ownership can improve commit behavior without a new author-facing path language.
- Home/settings links and Story/Task tab/Board-section component lists (`types.ts:451`, `:465`). Small records are sufficient.
- `PluginUi`'s own-plugin `open`, `back`, `toast`, `error` (`types.ts:376`). Param validation is the missing boundary; a general router framework is unnecessary.
- Doctor's plugin-prefixed codes and fix callback into a pending Change Set (`types.ts:348`). Identity-safe targeting is needed, but code-prefix UX is simple.
- `PluginCommandEnv` print/confirm/prompt/readText/resolveBoard (`types.ts:274`), with common global behavior centralized. Exposing `editText` here makes it more coherent.
- `boardSettings` deep merge with list replacement (`runtime.ts:173`). Keep activation at Data Root and overrides at Board; settings editing must preserve that rule.
- Deterministic registry order and explicit plain-language clash reasons (`host.ts:185`). Validate definitions better; do not add a dependency graph without a real dependency.
- Single non-TUI API plus lazy TUI import convention (`src/plugin-api/index.ts:1`; `src/plugin-api/tui.ts:1`). Preserve CLI startup and context identity through packaging.
- Architecture import tests for **trusted built-in conventions** (`test/architecture.test.ts:111`). Keep them without advertising them as containment of arbitrary external JavaScript.
