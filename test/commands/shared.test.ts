import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import {
  confirmDestructive,
  type GlobalOptions,
  parseFieldAssignments,
  parseRepeatable,
  promptIfMissing,
  readLongText,
} from '../../src/commands/_shared';
import { NotFoundError, UsageError } from '../../src/core';

const nonInteractive: GlobalOptions = { json: false, yes: false, prompt: false };

describe('parseRepeatable', () => {
  it('flattens repeated and comma-separated values', () => {
    expect(parseRepeatable(['a,b', ' c ', 'a', ''])).toEqual(['a', 'b', 'c']);
    expect(parseRepeatable('x')).toEqual(['x']);
    expect(parseRepeatable(undefined)).toEqual([]);
  });
});

describe('parseFieldAssignments', () => {
  it('parses key=value pairs, including comma-separated ones', () => {
    expect(parseFieldAssignments(['points=3', 'size=M,blocked=true'])).toEqual({
      points: '3',
      size: 'M',
      blocked: 'true',
    });
  });

  it('keeps commas inside multiselect values and = inside values', () => {
    expect(parseFieldAssignments(['env=dev,prod', 'spec=https://x.test/?a=b'])).toEqual({
      env: 'dev,prod',
      spec: 'https://x.test/?a=b',
    });
  });

  it.each([['points'], ['=3']])('rejects %j', (value) => {
    expect(() => parseFieldAssignments([value])).toThrow(UsageError);
  });
});

describe('readLongText', () => {
  it('returns inline text, or undefined when nothing is given', async () => {
    expect(await readLongText({ text: 'hi' }, { name: 'description' })).toBe('hi');
    expect(await readLongText({}, { name: 'description' })).toBeUndefined();
  });

  it('reads a file, or stdin for "-"', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rowbly-shared-'));
    await writeFile(join(dir, 'd.md'), '# Title\n\n');
    expect(await readLongText({ file: join(dir, 'd.md') }, { name: 'description' })).toBe('# Title');
    const stdin = Readable.from(['from ', 'stdin\n']);
    expect(await readLongText({ file: '-' }, { name: 'description', stdin })).toBe('from stdin');
    await expect(readLongText({ file: join(dir, 'missing.md') }, { name: 'description' })).rejects.toThrow(
      NotFoundError,
    );
  });

  it('opens $EDITOR with --edit', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rowbly-editor-'));
    const editor = join(dir, 'editor.sh');
    await writeFile(editor, '#!/bin/sh\nprintf "edited text\\n" > "$1"\n', { mode: 0o755 });
    const previous = { VISUAL: process.env.VISUAL, EDITOR: process.env.EDITOR };
    process.env.VISUAL = '';
    process.env.EDITOR = editor;
    try {
      expect(await readLongText({ edit: true }, { name: 'body' })).toBe('edited text');
    } finally {
      Object.assign(process.env, previous);
    }
  });

  it('rejects more than one source', async () => {
    await expect(readLongText({ text: 'a', edit: true }, { name: 'body' })).rejects.toThrow(UsageError);
  });
});

describe('prompting gates', () => {
  it('returns a given value without prompting', async () => {
    expect(await promptIfMissing('Acme', nonInteractive, { flag: '--name', message: 'Name' })).toBe('Acme');
  });

  it('fails with a UsageError naming the flag when not interactive', async () => {
    await expect(promptIfMissing(undefined, nonInteractive, { flag: '--name', message: 'Name' })).rejects.toThrow(
      'missing required --name',
    );
  });

  it('requires --yes for destructive actions when not interactive', async () => {
    await expect(confirmDestructive('delete board web', nonInteractive)).rejects.toThrow(UsageError);
    await expect(confirmDestructive('delete board web', { ...nonInteractive, yes: true })).resolves.toBeUndefined();
  });
});
