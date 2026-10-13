import { describe, expect, it } from 'vitest';
import { formatStoryKey, formatTaskId, isSlug, parseStoryKey, parseTaskId, UsageError } from '../../src/core';

describe('parseStoryKey', () => {
  it('accepts lower-case input and canonicalises it', () => {
    expect(parseStoryKey('web-42')).toEqual({ key: 'WEB-42', prefix: 'WEB', n: 42 });
    expect(parseStoryKey('API2-7')).toEqual({ key: 'API2-7', prefix: 'API2', n: 7 });
  });

  it.each(['WEB-0', 'WEB42', '1WEB-2', 'W-1', 'WEB-01', 'WEB-1.2', '', 'ABCDEFGHIJK-1'])('rejects %j', (input) => {
    expect(() => parseStoryKey(input)).toThrow(UsageError);
  });
});

describe('parseTaskId', () => {
  it('splits a Task id into its Story Key and task number', () => {
    expect(parseTaskId('web-42.3')).toEqual({
      id: 'WEB-42.3',
      storyKey: 'WEB-42',
      prefix: 'WEB',
      n: 42,
      taskNumber: 3,
    });
  });

  it.each(['WEB-42', 'WEB-42.0', 'WEB-42.', 'WEB-0.1'])('rejects %j', (input) => {
    expect(() => parseTaskId(input)).toThrow(UsageError);
  });
});

describe('formatters and slugs', () => {
  it('formats keys and ids', () => {
    expect(formatStoryKey('WEB', 5)).toBe('WEB-5');
    expect(formatTaskId('WEB-5', 2)).toBe('WEB-5.2');
  });

  it('validates slugs including length', () => {
    expect(isSlug('in-progress')).toBe(true);
    expect(isSlug('a'.repeat(40))).toBe(true);
    expect(isSlug('a'.repeat(41))).toBe(false);
    expect(isSlug('In-Progress')).toBe(false);
    expect(isSlug('a--b')).toBe(false);
    expect(isSlug('-a')).toBe(false);
  });
});
