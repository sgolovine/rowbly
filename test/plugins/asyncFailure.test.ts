// RES-18B: Plugin work must be returned or awaited. Rowbly catches what a callback returns, not
// work it leaves running; such work escapes every catch and ends the process (ADR-0020 §6, D8).
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { makeStory } from '../helpers';
import { pluginRoot, readJsonFile, storyFile } from './helpers';

const SCRIPT = fileURLToPath(new URL('./asyncFailure.fixture.ts', import.meta.url));
const TSX = fileURLToPath(new URL('../../node_modules/tsx/dist/loader.mjs', import.meta.url));

function runFixture(mode: 'awaited' | 'detached', root: string) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(process.execPath, ['--import', TSX, SCRIPT, mode, root], { env: { PATH: process.env.PATH } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += d;
    });
    child.stderr.on('data', (d) => {
      stderr += d;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

describe('asynchronous Plugin failures (RES-18B)', () => {
  it('supported: a returned or awaited rejection fails the operation, attributed, and nothing is saved', async () => {
    const t = await pluginRoot({ async: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const run = await runFixture('awaited', t.path);
    expect(run.code).toBe(0);
    expect(run.stdout).toBe(
      'failed INTERNAL: Plugin "async" failed in the transform of stories.update: awaited boom\n',
    );
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Story WEB-1');
  });

  it('unsupported: a detached throw escapes the operation, which has already saved, and ends the process', async () => {
    const t = await pluginRoot({ async: true });
    await makeStory(t.path, { boardId: 'web', key: 'WEB-1' });
    const run = await runFixture('detached', t.path);
    expect(run.code).not.toBe(0);
    expect(run.stdout).toBe('saved Renamed\n');
    expect(run.stderr).toContain('detached boom');
    // The operation itself finished; nothing caught the detached error for it.
    expect((await readJsonFile(t, storyFile('WEB-1'))).name).toBe('Renamed');
  });
});
