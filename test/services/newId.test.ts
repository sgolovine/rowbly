import { describe, expect, it } from 'vitest';
import { newId } from '../../src/services';

describe('newId', () => {
  it('generates 8 letters and digits, never a leading "-" the CLI would read as a flag', () => {
    for (let i = 0; i < 2_000; i++) expect(newId()).toMatch(/^[0-9A-Za-z]{8}$/);
  });
});
