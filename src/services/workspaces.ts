import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { RowblyContext, WorkspacesService } from './types';

// Stub: WP03 implements this service.
export function createWorkspacesService(_ctx: RowblyContext, _repos: Repositories): WorkspacesService {
  return {
    async list() {
      notImplemented('WP03');
    },
    async get() {
      notImplemented('WP03');
    },
    async create() {
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
