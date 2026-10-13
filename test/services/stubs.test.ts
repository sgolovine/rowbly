import { describe, expect, it } from 'vitest';
import { createDoctorService } from '../../src/services/doctor';
import type { RowblyContext } from '../../src/services/types';
import type { Repositories } from '../../src/storage';
import { fixedClock, fixedIds } from '../helpers';

const ctx: RowblyContext = {
  root: { path: '/tmp/.rowbly', kind: 'local' },
  local: { version: 1 },
  me: null,
  now: fixedClock().now,
  newId: fixedIds(),
  warn: () => {},
};

describe('service stubs', () => {
  it('reject with "not implemented: <WP>"', async () => {
    const repos = {} as Repositories;
    await expect(createDoctorService(ctx, repos).check()).rejects.toThrow('not implemented: WP10');
  });
});
