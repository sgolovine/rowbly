import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLI_PATH = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));

export interface RunCliOptions {
  /** Data Root path, passed as `ROWBLY_ROOT`. */
  root?: string;
  /** Extra environment; merged over the isolated defaults. */
  env?: NodeJS.ProcessEnv;
  /** Text piped to stdin; stdin is closed either way, so it is never a TTY. */
  stdin?: string;
  /** Working directory; defaults to a fresh empty temp directory. */
  cwd?: string;
}

export interface RunCliResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Runs the built `dist/cli.js` in a child process. HOME and cwd point at an empty temp directory so
 * no real `~/.rowbly` or git config leaks in, and colour is disabled.
 */
export async function runCli(args: string[], opts: RunCliOptions = {}): Promise<RunCliResult> {
  const isolated = await mkdtemp(join(tmpdir(), 'rowbly-cli-'));
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    HOME: isolated,
    NO_COLOR: '1',
    ...(opts.root ? { ROWBLY_ROOT: opts.root } : {}),
    ...opts.env,
  };
  try {
    return await run(args, opts.cwd ?? isolated, env, opts.stdin ?? '');
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
}

function run(args: string[], cwd: string, env: NodeJS.ProcessEnv, stdin: string): Promise<RunCliResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { cwd, env });
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
