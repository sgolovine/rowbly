import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { ContextService, RowblyContext } from './types';

// Stub: WP01 implements this service.
export function createContextService(_ctx: RowblyContext, _repos: Repositories): ContextService {
  return {
    async resolveWorkspace() {
      notImplemented('WP01');
    },
    async resolveBoard() {
      notImplemented('WP01');
    },
    async use() {
      notImplemented('WP01');
    },
    async clearUse() {
      notImplemented('WP01');
    },
    async setMe() {
      notImplemented('WP01');
    },
  };
}
