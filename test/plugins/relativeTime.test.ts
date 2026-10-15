import { describe, expect, it } from 'vitest';
import { relativeTime } from '../../src/plugins/comments/relativeTime';

describe('relativeTime', () => {
  it('formats relative times', () => {
    const now = new Date('2026-10-12T17:21:07.000Z');
    expect(relativeTime('2026-10-12T17:21:00.000Z', now)).toBe('just now');
    expect(relativeTime('2026-10-12T14:21:07.000Z', now)).toBe('3h ago');
    expect(relativeTime('2026-10-10T17:21:07.000Z', now)).toBe('2d ago');
    expect(relativeTime('2025-10-12T17:21:07.000Z', now)).toBe('1y ago');
  });
});
