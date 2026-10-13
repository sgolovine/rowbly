import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, onTestFinished } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { CLI_PATH, makeBoard, runCli, tempRoot } from './helpers';

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

const COMMAND_GROUPS = [
  'init',
  'use',
  'whoami',
  'config',
  'assignees',
  'boards',
  'stages',
  'fields',
  'stories',
  'tasks',
  'doctor',
];

describe('rowbly CLI', () => {
  it('prints its version', async () => {
    const result = await runCli(['--version']);
    expect(result).toEqual({ stdout: `${pkg.version}\n`, stderr: '', exitCode: 0 });
  });

  it('lists every command group in --help', async () => {
    const { stdout, exitCode } = await runCli(['--help']);
    expect(exitCode).toBe(0);
    for (const name of COMMAND_GROUPS) expect(stdout).toMatch(new RegExp(`^  ${name}\\b`, 'm'));
    for (const flag of ['--root <path>', '--json', '--yes', '--no-prompt', '--version']) expect(stdout).toContain(flag);
  });

  it('shows global flags in subcommand help', async () => {
    const { stdout, exitCode } = await runCli(['stories', 'list', '--help']);
    expect(exitCode).toBe(0);
    expect(stdout).toContain('--no-prompt');
  });

  it('reports errors as JSON with --json', async () => {
    const { stdout, stderr, exitCode } = await runCli(['doctor', '--json']);
    expect(exitCode).toBe(5);
    expect(stdout).toBe('');
    expect(JSON.parse(stderr)).toEqual({ error: { code: 'NO_DATA_ROOT', message: 'no Data Root found', details: {} } });
  });

  it('exits 2 for an unknown command or option', async () => {
    const command = await runCli(['bogus']);
    expect(command.exitCode).toBe(2);
    expect(command.stderr).toContain("error: unknown command 'bogus'");
    const option = await runCli(['--bogus', '--json']);
    expect(option.exitCode).toBe(2);
    expect(JSON.parse(option.stderr).error.code).toBe('USAGE');
  });

  it('prints help and exits 2 for a command group without a verb', async () => {
    const { stderr, exitCode } = await runCli(['stories']);
    expect(exitCode).toBe(2);
    expect(stderr).toContain('Usage: rowbly stories');
  });

  it('prints help and exits 2 with no arguments and no TTY', async () => {
    const { stdout, stderr, exitCode } = await runCli([]);
    expect(exitCode).toBe(2);
    expect(stdout).toBe('');
    expect(stderr).toContain('Usage: rowbly');
  });

  it('treats only global flags as no command: help and exit 2 without a TTY', async () => {
    const t = await tempRoot();
    for (const args of [
      ['--root', t.path],
      [`--root=${t.path}`, '--json'],
      ['--no-prompt', '--yes'],
    ]) {
      const { stdout, stderr, exitCode } = await runCli(args);
      expect({ args, exitCode, stdout }).toEqual({ args, exitCode: 2, stdout: '' });
      expect(stderr).toContain('Usage: rowbly');
    }
  });
});

describe.skipIf(!hasScript)('rowbly in a terminal', () => {
  it('opens the TUI on the --root Data Root when only global flags are given', async () => {
    const t = await tempRoot();
    await makeBoard(t.path, { id: 'web', keyPrefix: 'WEB', name: 'Web' });
    // The cwd has no Data Root of its own, so the board can only come from --root.
    const cwd = await mkdtemp(join(tmpdir(), 'rowbly-tty-'));
    onTestFinished(() => rm(cwd, { recursive: true, force: true }));
    const { output, exitCode } = await runInTty(['--root', t.path, '--json'], cwd, '● Backlog (0)');
    expect(exitCode).toBe(0);
    expect(output).toContain('● Backlog (0)');
    expect(output).not.toContain('No Data Root found');
  });

  it('fails with exit 5 when --root names a missing Data Root', async () => {
    const t = await tempRoot();
    const { output, exitCode } = await runInTty(['--root', `${t.dir}/missing`], t.dir, 'error:');
    expect(exitCode).toBe(5);
    expect(output).toContain(`error: Data Root not found: ${t.dir}/missing`);
  });
});
