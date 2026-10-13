import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { CommentsService, RowblyContext } from './types';

// Stub: WP06 implements this service.
export function createCommentsService(_ctx: RowblyContext, _repos: Repositories): CommentsService {
  return {
    async list() {
      notImplemented('WP06');
    },
    async add() {
      notImplemented('WP06');
    },
    async update() {
      notImplemented('WP06');
    },
    async remove() {
      notImplemented('WP06');
    },
  };
}
