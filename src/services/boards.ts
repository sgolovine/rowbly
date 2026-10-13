import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { BoardsService, RowblyContext } from './types';

// Stub: WP04 implements this service.
export function createBoardsService(_ctx: RowblyContext, _repos: Repositories): BoardsService {
  return {
    async list() {
      notImplemented('WP04');
    },
    async get() {
      notImplemented('WP04');
    },
    async create() {
      notImplemented('WP04');
    },
    async update() {
      notImplemented('WP04');
    },
    async remove() {
      notImplemented('WP04');
    },
  };
}
