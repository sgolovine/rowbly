import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { DoctorService, RowblyContext } from './types';

// Stub: WP10 implements this service.
export function createDoctorService(_ctx: RowblyContext, _repos: Repositories): DoctorService {
  return {
    async check() {
      notImplemented('WP10');
    },
    async fix() {
      notImplemented('WP10');
    },
  };
}
