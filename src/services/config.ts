import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { ConfigService, RowblyContext } from './types';

// Stub: WP01 implements this service.
export function createConfigService(_ctx: RowblyContext, _repos: Repositories): ConfigService {
  return {
    async effective() {
      notImplemented('WP01');
    },
  };
}
