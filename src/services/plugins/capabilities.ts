// The services a Plugin can reach (ADR-0020 §1, ARCH-05). Each projection is a new object that holds
// only the allowed methods, so a Plugin cannot get past it by ignoring the types. This guards against
// accidental misuse; it is not a sandbox.
import type { Services } from '../types';
import type { PluginReadServices, PluginServices } from './types';

/** The services of commands and screens: no `plugins`, no `setup`, and doctor checks only. */
export function pluginServices(services: Services): PluginServices {
  const { context, config, boards, stages, fields, stories, doctor, featureFlags } = services;
  return {
    featureFlags,
    context,
    config,
    boards,
    stages,
    fields,
    stories,
    doctor: { check: () => doctor.check() },
  };
}

/** The read-only services of hooks: list, get, effective-config and Board-resolution methods. */
export function pluginReadServices(services: Services): PluginReadServices {
  const { context, config, boards, stages, fields, stories, featureFlags } = services;
  return {
    featureFlags: { list: () => featureFlags.list(), isEnabled: (key) => featureFlags.isEnabled(key) },
    context: { resolveBoard: (flag) => context.resolveBoard(flag) },
    config: { effective: (boardId) => config.effective(boardId), global: () => config.global() },
    boards: { list: () => boards.list(), get: (id) => boards.get(id) },
    stages: { list: (boardId) => stages.list(boardId) },
    fields: { list: (boardId) => fields.list(boardId) },
    stories: {
      list: (boardId, filter) => stories.list(boardId, filter),
      get: (key) => stories.get(key),
      labelsInUse: (boardId) => stories.labelsInUse(boardId),
    },
  };
}
