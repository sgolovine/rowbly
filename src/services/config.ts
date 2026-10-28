import { type Repositories, resolveCascade, resolveGlobal } from '../storage';
import type { OperationRunner } from './plugins/runtime';
import type { ConfigService, RowblyContext } from './types';

export function createConfigService(ctx: RowblyContext, _repos: Repositories, ops: OperationRunner): ConfigService {
  return {
    updateRootConfig: (patch, opts = {}) =>
      ops.run('config.updateRootConfig', { ...patch, ...opts }, (changes) =>
        changes.updateRootConfig((config) => ({ ...config, onboardingComplete: patch.onboardingComplete })),
      ),
    effective: (boardId) => resolveCascade(ctx.root, boardId),
    global: () => resolveGlobal(ctx.root),
  };
}
