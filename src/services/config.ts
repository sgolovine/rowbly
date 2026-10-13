import { type Repositories, resolveCascade } from '../storage';
import type { ConfigService, RowblyContext } from './types';

export function createConfigService(ctx: RowblyContext, _repos: Repositories): ConfigService {
  return {
    effective: (ref) => resolveCascade(ctx.root, ref),
  };
}
