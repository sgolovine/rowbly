import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { RowblyContext, SetupService } from './types';

// Stub: WP08 implements this service.
export function createSetupService(_ctx: RowblyContext, _repos: Repositories): SetupService {
  return {
    async init() {
      notImplemented('WP08');
    },
  };
}
