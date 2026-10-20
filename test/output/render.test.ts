import { describe, expect, it } from 'vitest';
import { NotFoundError } from '../../src/core';
import { printError } from '../../src/output';

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
});
