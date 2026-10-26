import { type Repositories, resolveCascade, resolveGlobal } from '../storage';
import type { ConfigService, RowblyContext } from './types';

export function createConfigService(ctx: RowblyContext, _repos: Repositories): ConfigService {
  return {
    effective: (boardId) => resolveCascade(ctx.root, boardId),
    global: () => resolveGlobal(ctx.root),
  };
}
