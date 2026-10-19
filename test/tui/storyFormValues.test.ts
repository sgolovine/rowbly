// The Story form narrows its Priority value instead of trusting casts (CQ-79).
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/core';
import { priorityValue } from '../../src/tui/screens/stories/storyFormValues';

describe('Story form values', () => {
  it('passes valid Priorities, and empty values as none', () => {
    expect(priorityValue('P1')).toBe('P1');
    expect(priorityValue('(none)')).toBeNull();
    expect(priorityValue(null)).toBeNull();
  });

  it.each([
    ['priority', () => priorityValue('urgent-ish')],
    ['priority', () => priorityValue(3)],
    ['priority', () => priorityValue(['P1'])],
  ])('rejects a malformed %s value as a validation error on that field', (field, read) => {
    let error: unknown;
    try {
      read();
    } catch (err) {
      error = err;
    }
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).details.issues).toEqual([expect.objectContaining({ path: [field] })]);
  });
});
