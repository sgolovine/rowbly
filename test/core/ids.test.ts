import { describe, expect, it } from 'vitest';
import {
  formatStoryKey,
  isSlug,
  KEY_PREFIX_RE,
  keyPrefixFromName,
  parseStoryKey,
  slugFromName,
  UsageError,
} from '../../src/core';

describe('parseStoryKey', () => {
  it('accepts lower-case input and canonicalises it', () => {
    expect(parseStoryKey('web-42')).toEqual({ key: 'WEB-42', prefix: 'WEB', n: 42 });
    expect(parseStoryKey('API2-7')).toEqual({ key: 'API2-7', prefix: 'API2', n: 7 });
  });

  it.each(['WEB-0', 'WEB42', '1WEB-2', 'W-1', 'WEB-01', 'WEB-1.2', '', 'ABCDEFGHIJK-1'])('rejects %j', (input) => {
    expect(() => parseStoryKey(input)).toThrow(UsageError);
  });
});

describe('formatters and slugs', () => {
  it('formats Story Keys', () => {
    expect(formatStoryKey('WEB', 5)).toBe('WEB-5');
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

describe('slugFromName', () => {
  it.each([
    ['Rowbly', 'rowbly'],
    ['My Web App', 'my-web-app'],
    ['  Café / API v2! ', 'cafe-api-v2'],
    ['!!!', 'board'],
  ])('%j → %j', (name, slug) => {
    expect(slugFromName(name)).toBe(slug);
  });

  it('numbers a taken slug and stays within the length limit', () => {
    expect(slugFromName('Web', new Set(['web', 'web-2']))).toBe('web-3');
    const long = slugFromName('a'.repeat(50), new Set(['a'.repeat(40)]));
    expect(long).toBe(`${'a'.repeat(38)}-2`);
    expect(isSlug(long)).toBe(true);
  });
});

describe('keyPrefixFromName', () => {
  it.each([
    ['Rowbly', 'ROW'],
    ['My Web App', 'MWA'],
    ['web-app', 'WA'],
    ['2024 Roadmap', 'ROA'],
    ['X', 'XBR'],
    ['42', 'BRD'],
    ['a b c d e f g h i j k l', 'ABCDEFGHIJ'],
  ])('%j → %j', (name, prefix) => {
    expect(keyPrefixFromName(name)).toBe(prefix);
    expect(KEY_PREFIX_RE.test(prefix)).toBe(true);
  });

  it('numbers a taken prefix', () => {
    expect(keyPrefixFromName('Rowbly', new Set(['ROW', 'ROW2']))).toBe('ROW3');
    expect(keyPrefixFromName('a b c d e f g h i j', new Set(['ABCDEFGHIJ']))).toBe('ABCDEFGHI2');
  });
});
