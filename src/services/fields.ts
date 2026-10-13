import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { FieldsService, RowblyContext } from './types';

// Stub: WP04 implements this service.
export function createFieldsService(_ctx: RowblyContext, _repos: Repositories): FieldsService {
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
    async remove() {
      notImplemented('WP04');
    },
  };
}
