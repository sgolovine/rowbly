import { describe, expect, it } from 'vitest';
import pkg from '../package.json' with { type: 'json' };
import { runCli } from './helpers';

const COMMAND_GROUPS = [
  'init',
  'use',
  'whoami',
  'config',
  'workspaces',
  'assignees',
  'boards',
  'stages',
  'fields',
  'stories',
  'tasks',
  'comments',
  'epics',
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
});
