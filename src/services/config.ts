import { type Repositories, resolveCascade, resolveGlobal } from '../storage';
import type { OperationRunner } from './plugins/runtime';
import type { ConfigService, RowblyContext } from './types';

export function createConfigService(ctx: RowblyContext, _repos: Repositories, ops: OperationRunner): ConfigService {
  return {
    updateRootConfig: (patch, opts = {}) =>
      ops.run('config.updateRootConfig', { ...patch, ...opts }, (changes) =>
        // Only the keys given change, so saving step progress never clears completion (ADR-0057).
        changes.updateRootConfig((config) => ({
          ...config,
          ...(patch.onboardingComplete === undefined ? {} : { onboardingComplete: patch.onboardingComplete }),
          ...(patch.onboardingSteps === undefined ? {} : { onboardingSteps: patch.onboardingSteps }),
        })),
      ),
    effective: (boardId) => resolveCascade(ctx.root, boardId),
    global: () => resolveGlobal(ctx.root),
  };
}
