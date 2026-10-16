import { describe, expect, it } from 'vitest';
import { NotFoundError, ValidationError } from '../../src/core';
import { printError, printResult, printWarnings, renderTable } from '../../src/output';

function capture() {
  const out = { stdout: '', stderr: '' };
  const streams = {
    stdout: { write: (chunk: string) => (out.stdout += chunk) },
    stderr: { write: (chunk: string) => (out.stderr += chunk) },
  };
  return { out, streams };
}

describe('printError', () => {
  it('writes the exact contracts §6 JSON shape to stderr', () => {
    const { out, streams } = capture();
    printError(new NotFoundError('story WEB-9 not found', { details: { key: 'WEB-9' } }), { json: true, streams });
    expect(out.stdout).toBe('');
    expect(out.stderr).toBe(
      '{"error":{"code":"NOT_FOUND","message":"story WEB-9 not found","details":{"key":"WEB-9"}}}\n',
    );
  });

  it('includes the hint when the error has one (contracts §10)', () => {
    const { out, streams } = capture();
    printError(new NotFoundError('no such board', { hint: 'run `rowbly boards list`' }), { json: true, streams });
    expect(JSON.parse(out.stderr)).toEqual({
      error: { code: 'NOT_FOUND', message: 'no such board', details: {}, hint: 'run `rowbly boards list`' },
    });
  });

  it('always includes details and reports unknown errors as INTERNAL', () => {
    const { out, streams } = capture();
    printError(new ValidationError('bad'), { json: true, streams });
    printError(new Error('boom'), { json: true, streams });
    const [validation, internal] = out.stderr
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(validation).toEqual({ error: { code: 'VALIDATION', message: 'bad', details: {} } });
    expect(internal).toEqual({ error: { code: 'INTERNAL', message: 'boom', details: {} } });
  });

  it('writes `error:` and the hint in human mode', () => {
    const { out, streams } = capture();
    printError(new NotFoundError('no such board', { hint: 'run rowbly boards list' }), { json: false, streams });
    expect(out.stderr).toContain('error: no such board');
    expect(out.stderr).toContain('hint: run rowbly boards list');
  });
});

describe('printResult', () => {
  it('pretty-prints JSON to stdout', () => {
    const { out, streams } = capture();
    printResult({ a: 1 }, { json: true, human: () => 'nope', streams });
    expect(out.stdout).toBe('{\n  "a": 1\n}\n');
  });

  it('uses the human renderer and adds a trailing newline', () => {
    const { out, streams } = capture();
    printResult({ a: 1 }, { json: false, human: (d) => `a=${d.a}`, streams });
    printResult({ a: 2 }, { json: false, human: () => '', streams });
    expect(out.stdout).toBe('a=1\n');
  });
});

describe('printWarnings', () => {
  it('writes JSON warning lines or human warnings to stderr', () => {
    const json = capture();
    printWarnings(['removed from 1 story', 'x'], { json: true, streams: json.streams });
    expect(json.out.stderr).toBe('{"warning":"removed from 1 story"}\n{"warning":"x"}\n');
    const human = capture();
    printWarnings(['removed from 1 story'], { json: false, streams: human.streams });
    expect(human.out.stderr).toContain('warning: removed from 1 story');
  });
});

describe('renderTable', () => {
  it('renders aligned rows', () => {
    const table = renderTable(
      ['KEY', 'NAME'],
      [
        ['WEB-1', 'Login'],
        ['WEB-10', 'Signup'],
      ],
    );
    expect(table).toContain('WEB-10');
    expect(table.split('\n')).toHaveLength(3);
  });
});

describe('table headers', () => {
  it('are upper case in every command table', async () => {
    const { readdir, readFile } = await import('node:fs/promises');
    const dir = new URL('../../src/commands/', import.meta.url);
    const heads: string[] = [];
    for (const file of await readdir(dir)) {
      const source = await readFile(new URL(file, dir), 'utf8');
      for (const [, head] of source.matchAll(/renderTable\(\s*\[([^\]]*)\]/g)) {
        heads.push(...[...(head ?? '').matchAll(/'([^']*)'/g)].map(([, title]) => `${file}: ${title}`));
      }
    }
    expect(heads.length).toBeGreaterThan(20);
    expect(heads.filter((h) => h.split(': ')[1] !== h.split(': ')[1]?.toUpperCase())).toEqual([]);
  });
});
