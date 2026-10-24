import { spawn } from 'node:child_process';

export interface GitProcessOptions {
  input?: string | Uint8Array;
  index?: string;
  timeoutMs?: number;
  allowFailure?: boolean;
}
/** Host-only argv execution: finite time/output, closed input, no interactive helpers or inherited Git overrides. */
export function gitProcess(
  cwd: string,
  args: readonly string[],
  options: GitProcessOptions = {},
): Promise<{ code: number; stdout: Buffer; stderr: string }> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('GIT_')));
  return new Promise((resolve, reject) => {
    const child = spawn(
      'git',
      [
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'core.fsmonitor=false',
        '-c',
        'commit.gpgSign=false',
        '-c',
        'credential.interactive=false',
        ...args,
      ],
      {
        cwd,
        detached: process.platform !== 'win32',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: {
          ...env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: '/bin/false',
          SSH_ASKPASS: '/bin/false',
          GCM_INTERACTIVE: 'Never',
          GIT_EDITOR: '/bin/false',
          GIT_SEQUENCE_EDITOR: '/bin/false',
          GIT_SSH_COMMAND: 'ssh -oBatchMode=yes -oStrictHostKeyChecking=yes -oControlMaster=no -oControlPersist=no',
          ...(options.index ? { GIT_INDEX_FILE: options.index } : {}),
        },
      },
    );
    const out: Buffer[] = [],
      errors: Buffer[] = [];
    let size = 0,
      failure: Error | undefined;
    const stop = (error: Error) => {
      failure ??= error;
      if (child.pid && process.platform !== 'win32') {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* Already exited. */
        }
      } else child.kill('SIGKILL');
    };
    const timer = setTimeout(
      () => stop(new Error('Git automation exceeded its process deadline')),
      options.timeoutMs ?? 3500,
    );
    const collect = (chunks: Buffer[]) => (bytes: Buffer) => {
      size += bytes.length;
      if (size > 16 * 1024 * 1024) stop(new Error('Git automation exceeded its output bound'));
      else chunks.push(bytes);
    };
    child.stdout.on('data', collect(out));
    child.stderr.on('data', collect(errors));
    child.stdin.on('error', () => undefined);
    child.on('error', (err) => {
      failure ??= err;
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      const stderr = Buffer.concat(errors).toString('utf8');
      if (failure) reject(failure);
      else if (code !== 0 && !options.allowFailure)
        reject(new Error(`Git ${args[0] ?? 'command'} failed: ${stderr.slice(0, 2000)}`));
      else resolve({ code: code ?? -1, stdout: Buffer.concat(out), stderr });
    });
    child.stdin.end(options.input);
  });
}
export async function gitText(cwd: string, args: readonly string[], options: GitProcessOptions = {}): Promise<string> {
  return (await gitProcess(cwd, args, options)).stdout.toString('utf8').trim();
}
