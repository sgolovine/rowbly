import type { Repositories } from '../storage';
import { notImplemented } from './_stub';
import type { RowblyContext, StoriesService } from './types';

// Stub: WP05 implements this service.
export function createStoriesService(_ctx: RowblyContext, _repos: Repositories): StoriesService {
  return {
    async list() {
      notImplemented('WP05');
    },
    async get() {
      notImplemented('WP05');
    },
    async create() {
      notImplemented('WP05');
    },
    async update() {
      notImplemented('WP05');
    },
    async move() {
      notImplemented('WP05');
    },
    async rank() {
      notImplemented('WP05');
    },
    async remove() {
      notImplemented('WP05');
    },
    async labelsInUse() {
      notImplemented('WP05');
    },
  };
}
