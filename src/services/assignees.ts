import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { AssigneesService, RowblyContext } from './types';

// Stub: WP03 implements this service.
export function createAssigneesService(_ctx: RowblyContext, _repos: Repositories): AssigneesService {
  return {
    async list() {
      notImplemented('WP03');
    },
    async add() {
      notImplemented('WP03');
    },
    async update() {
      notImplemented('WP03');
    },
    async remove() {
      notImplemented('WP03');
    },
  };
}
