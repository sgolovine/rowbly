// The Plugin API (ADR-0009): the only module a Plugin imports, besides `plugin-api/tui` for its TUI
// part. It re-exports what Plugins need from core; everything else reaches a Plugin at run time,
// through the `PluginContext` its handlers, commands, screens and Actions receive. See
// docs/PLUGINS.md, "Writing a Built-in Plugin".
//
// Export inventory (DX-33). Named types are exported when a public example, a built-in or a fixture
// annotates with them. Deliberately not exported:
// - `Services`, `OperationRunner`, `PluginHost`, `ActivePlugin`, `invokePlugin`: core wiring; Plugins get
//   `PluginServices` / `PluginReadServices` and contexts at run time (ARCH-05).
// - `PluginError`: the framework's attribution error. A Plugin throws the expected errors below, or
//   any other error, which Rowbly attributes itself (ADR-0020 §5).
// - `DoctorFinding`, `DoctorReport`: core doctor output; a Plugin returns `PluginFinding`s.
// - `validatePluginDefinition`: exposed through the test harness instead (WP07B).
// - `PLUGIN_OPTION_COMMANDS`: `PluginOptionCommand` names the same commands as a type.

import type { ZodType } from 'zod';
import type { PluginDefinition, PluginInputSchemas } from '../services';

export type { Command } from 'commander';
export { z } from 'zod';
export {
  ConflictError,
  DataIntegrityError,
  isSlug,
  isTaskId,
  NotFoundError,
  parseRepeatable,
  parseStoryKey,
  parseTaskId,
  RowblyError,
  toTimestamp,
  UsageError,
  ValidationError,
} from '../core';
export { colors, renderTable } from '../output';
export type {
  Assignee,
  BoardConfig,
  CustomFieldDef,
  CustomFieldValue,
  EffectiveBoardConfig,
  Label,
  LocalState,
  PluginBags,
  Priority,
  RowblyConfig,
  Slug,
  Stage,
  StageCategory,
  Story,
  StoryKey,
  Task,
  TaskId,
  Timestamp,
} from '../schemas';
export { SlugSchema, StoryKeySchema, TimestampSchema } from '../schemas';
export type {
  ActionFocus,
  ActionFocusOf,
  ActionTarget,
  AnyPluginDefinition,
  Bagged,
  BagInspection,
  BoardChange,
  Change,
  ChangeSet,
  ChangeSetView,
  CoreOperationName,
  CoreOperations,
  DeepReadonly,
  DoctorData,
  DoctorSeverity,
  FileChange,
  FileScope,
  GuardEvent,
  GuardResult,
  LocalStateChange,
  OperationHookMap,
  OperationHooks,
  OperationInput,
  OperationOptions,
  PluginAction,
  PluginActionOf,
  PluginBagSchemas,
  PluginBoardSectionProps,
  PluginChangeSet,
  PluginChangeSetView,
  PluginCli,
  PluginCommandEnv,
  PluginCommandOptions,
  PluginCommands,
  PluginContext,
  PluginDefinition,
  PluginDoctor,
  PluginFieldKind,
  PluginFiles,
  PluginFilterOptions,
  PluginFinding,
  PluginFormField,
  PluginFormValue,
  PluginHookContext,
  PluginInput,
  PluginInputOptions,
  PluginInputSchemas,
  PluginLink,
  PluginOperationOptions,
  PluginOption,
  PluginOptionCommand,
  PluginOptionOperations,
  PluginOptionValues,
  PluginPayload,
  PluginReadContext,
  PluginReadServices,
  PluginRow,
  PluginScreenProps,
  PluginServices,
  PluginStatus,
  PluginStoryFilter,
  PluginStoryForm,
  PluginStoryTabProps,
  PluginTaskTabProps,
  PluginTui,
  PluginUi,
  ReactionEvent,
  Replacement,
  ReplacementEvent,
  ReplacementMap,
  RootConfigChange,
  StoryChange,
  StoryFilter,
  StoryPatch,
  TransformEvent,
} from '../services';
// The full `Services` type is not exported: Plugins get `PluginServices` or `PluginReadServices` (ARCH-05).
export { CORE_OPERATION_NAMES } from '../services';

/**
 * Declares a Plugin. It only gives the definition its type; the registry in `src/plugins/` lists it.
 * The settings type `S` is inferred from `settings` (`Record<string, unknown>` without a schema, when
 * the raw entry is passed through unchecked), and the input and filter types from `inputs` and
 * `storyFilterSchema`, so hooks, option converters and `filterStories` need no casts.
 */
export function definePlugin<
  S = Record<string, unknown>,
  In extends PluginInputSchemas = Record<never, never>,
  FS extends ZodType = ZodType,
>(definition: PluginDefinition<S, In, FS>): PluginDefinition<S, In, FS> {
  return definition;
}
