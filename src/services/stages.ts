import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { RowblyContext, StagesService } from './types';

// Stub: WP04 implements this service.
export function createStagesService(_ctx: RowblyContext, _repos: Repositories): StagesService {
  return {
    async list() {
      notImplemented('WP04');
    },
    async add() {
      notImplemented('WP04');
    },
    async update() {
      notImplemented('WP04');
    },
    async move() {
      notImplemented('WP04');
    },
    async remove() {
      notImplemented('WP04');
    },
  };
}
