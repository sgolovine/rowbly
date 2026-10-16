import { Option } from 'commander';
import { describe, expect, it } from 'vitest';
import { attributeName } from '../../src/services/plugins/host';

// The host names option attributes without loading Commander (ARCH-01), so it must agree with it.
describe('attributeName', () => {
  it("matches Commander's attribute names", () => {
    for (const flag of [
      'epic',
      'no-epic',
      'add-spec',
      'no-reset-specs',
      'foo-1-bar',
      'foo1-bar',
      'x',
      'no-x',
      'a-b-c',
    ]) {
      expect(attributeName(flag)).toBe(new Option(`--${flag}`).attributeName());
    }
  });
});
