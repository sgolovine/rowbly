import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import { CLI_PATH, makeBoard, tempRoot } from './helpers';

/** util-linux `script` gives the CLI a pseudo-terminal, so stdin and stdout are TTYs. */
const hasScript = process.platform === 'linux' && spawnSync('script', ['--version']).status === 0;

/**
 * Runs the built CLI in a pseudo-terminal until `ready` appears on screen, then types `q`. Resolves
 * with the exit code and the screen output (escape sequences stripped).
 */
function runInTty(args: string[], cwd: string, ready: string): Promise<{ output: string; exitCode: number }> {
  const quote = (arg: string) => `'${arg.replaceAll("'", "'\\''")}'`;
  const command = [process.execPath, CLI_PATH, ...args].map(quote).join(' ');
  const child = spawn('script', ['-qfec', command, '/dev/null'], {
    cwd,
    env: { PATH: process.env.PATH, HOME: cwd, NO_COLOR: '1', TERM: 'xterm' },
  });
  let output = '';
  let typed = false;
  return new Promise((resolve, reject) => {
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      // biome-ignore lint/suspicious/noControlCharactersInRegex: strips terminal escape sequences.
      output += chunk.replace(/\u001B\[[0-9;?]*[A-Za-z]/g, '');
      if (typed || !output.includes(ready)) return;
      typed = true;
      child.stdin.write('q');
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ output, exitCode: code ?? 1 }));
  });
}

describe.skipIf(!hasScript)('rowbly in a terminal', () => {
  it('opens the TUI on the --data-root Data Root when only global flags are given', async () => {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB', name: 'Web' });
    // The cwd has no Data Root of its own, so the board can only come from --data-root.
    const cwd = await mkdtemp(join(tmpdir(), 'rowbly-tty-'));
    onTestFinished(() => rm(cwd, { recursive: true, force: true }));
    const { output, exitCode } = await runInTty(['--data-root', t.path, '--json'], cwd, '● Backlog 0');
    expect(exitCode).toBe(0);
    expect(output).toContain('● Backlog 0');
    expect(output).not.toContain('No Data Root found');
  });
});
