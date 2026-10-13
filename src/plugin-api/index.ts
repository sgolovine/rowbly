// The Plugin API (ADR-0009): the only module a Plugin imports, besides `plugin-api/tui` for its TUI
// part. It re-exports what Plugins need from core; everything else reaches a Plugin at run time,
// through the `PluginContext` its handlers, commands, screens and Actions receive. See
// docs/PLUGINS.md, "Writing a Built-in Plugin".
import type { PluginDefinition } from '../services';

export { z } from 'zod';
export {
  ConflictError,
  isSlug,
  NotFoundError,
  parseStoryKey,
  RowblyError,
  toTimestamp,
  UsageError,
  ValidationError,
} from '../core';
export { colors, renderTable } from '../output';
export type {
  Assignee,
  BoardConfig,
  Comment,
  CustomFieldDef,
  CustomFieldValue,
  EffectiveBoardConfig,
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
  ActionTarget,
  AnyPluginDefinition,
  Bagged,
  BoardChange,
  Change,
  ChangeSet,
  ChangeSetView,
  CoreOperationName,
  CoreOperations,
  DoctorData,
  DoctorSeverity,
  FileChange,
  FileScope,
  GuardResult,
  LocalStateChange,
  OperationEvent,
  OperationHookMap,
  OperationHooks,
  OperationInput,
  OperationOptions,
  PluginAction,
  PluginBagSchemas,
  PluginBoardSectionProps,
  PluginChangeSet,
  PluginCli,
  PluginCommandEnv,
  PluginCommandOptions,
  PluginContext,
  PluginDefinition,
  PluginDoctor,
  PluginFiles,
  PluginFinding,
  PluginFormField,
  PluginFormValue,
  PluginInput,
  PluginLink,
  PluginOptionCommand,
  PluginRow,
  PluginScreenProps,
  PluginStoryFilter,
  PluginStoryForm,
  PluginStoryTabProps,
  PluginTui,
  PluginUi,
  ReactEvent,
  Replacement,
  ReplacementMap,
  RootConfigChange,
  Services,
  StoryChange,
  StoryFilter,
  StoryPatch,
} from '../services';

/** Declares a Plugin. It only gives the definition its type; the registry in `src/plugins/` lists it. */
export function definePlugin<S = Record<string, unknown>>(definition: PluginDefinition<S>): PluginDefinition<S> {
  return definition;
}
