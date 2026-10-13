import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { RowblyContext, TasksService } from './types';

// Stub: WP06 implements this service.
export function createTasksService(_ctx: RowblyContext, _repos: Repositories): TasksService {
  return {
    async list() {
      notImplemented('WP06');
    },
    async get() {
      notImplemented('WP06');
    },
    async create() {
      notImplemented('WP06');
    },
    async update() {
      notImplemented('WP06');
    },
    async move() {
      notImplemented('WP06');
    },
    async remove() {
      notImplemented('WP06');
    },
  };
}
