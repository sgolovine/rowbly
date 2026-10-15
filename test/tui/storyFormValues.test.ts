// The Story form narrows its Assignee and Priority values instead of trusting casts (CQ-79).
import { describe, expect, it } from 'vitest';
import { ValidationError } from '../../src/core';
import { assigneesValue, priorityValue } from '../../src/tui/screens/stories/storyFormValues';

describe('Story form values', () => {
  it('passes valid Assignees and Priorities, and empty values as none', () => {
    expect(assigneesValue(['alice', 'bob'])).toEqual(['alice', 'bob']);
    expect(assigneesValue(null)).toEqual([]);
    expect(assigneesValue(undefined)).toEqual([]);
    expect(priorityValue('P1')).toBe('P1');
    expect(priorityValue('(none)')).toBeNull();
    expect(priorityValue(null)).toBeNull();
  });

  it.each([
    ['assignees', () => assigneesValue('alice')],
    ['assignees', () => assigneesValue(true)],
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
