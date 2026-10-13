import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { EpicsService, RowblyContext } from './types';

// Stub: WP07 implements this service.
export function createEpicsService(_ctx: RowblyContext, _repos: Repositories): EpicsService {
  return {
    async list() {
      notImplemented('WP07');
    },
    async get() {
      notImplemented('WP07');
    },
    async create() {
      notImplemented('WP07');
    },
    async update() {
      notImplemented('WP07');
    },
    async setClosed() {
      notImplemented('WP07');
    },
    async remove() {
      notImplemented('WP07');
    },
  };
}
