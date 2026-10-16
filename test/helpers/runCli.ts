import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { inject, type ProvidedContext } from 'vitest';

/**
 * Stands in for a CLI path in suites that run without the CLI build: vitest.config.ts runs a suite
 * with the build only when it mentions `runCli` or a CLI path.
 */
const NOT_BUILT = '<no CLI build in this Vitest project; see vitest.config.ts>';
const builds: ProvidedContext['cliBuilds'] | undefined = inject('cliBuilds');

/** The CLI that this test run built from the current source (test/helpers/globalSetup.ts). */
export const CLI_PATH = builds?.cli ?? NOT_BUILT;
/** The same program with the fixture Plugins of test/plugins/fixtures as its registry. */
export const FIXTURE_CLI_PATH = builds?.fixtureCli ?? NOT_BUILT;

export interface RunCliOptions {
  /** Data Root path, passed as `ROWBLY_ROOT`. */
  root?: string;
  /** Extra environment; merged over the isolated defaults. */
  env?: NodeJS.ProcessEnv;
  /** Text piped to stdin; stdin is closed either way, so it is never a TTY. */
  stdin?: string;
  /** Working directory; defaults to a fresh empty temp directory. */
  cwd?: string;
  /** The built CLI to run; defaults to `CLI_PATH`. */
  cli?: string;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs the CLI that this test run built in a child process. HOME and cwd point at an empty temp directory so
 * no real `~/.rowbly` or git config leaks in, and colour is disabled.
 */
export async function runCli(args: string[], opts: RunCliOptions = {}): Promise<RunCliResult> {
  const cli = opts.cli ?? CLI_PATH;
  if (cli === NOT_BUILT) throw new Error(`runCli: ${NOT_BUILT}`);
  const isolated = await mkdtemp(join(tmpdir(), 'rowbly-cli-'));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: isolated,
    NO_COLOR: '1',
    ...(opts.root ? { ROWBLY_ROOT: opts.root } : {}),
    ...opts.env,
  };
  try {
    return await run(cli, args, opts.cwd ?? isolated, env, opts.stdin ?? '');
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}

function run(cli: string, args: string[], cwd: string, env: NodeJS.ProcessEnv, stdin: string): Promise<RunCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, env });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => resolve({ stdout, stderr, exitCode: code ?? 1 }));
    child.stdin.end(stdin);
  });
}
