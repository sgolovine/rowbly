import { spawn } from 'node:child_process';
import { UsageError, ValidationError } from '../core';

/** Host-owned templates, not executable or argv supplied by a Plugin (ADR-0051 §1). */
export type ExternalReadName = 'gh-pr-view' | 'gh-pr-commits';
export interface ExternalReadResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const COMMITS_QUERY = `query($account: String!, $name: String!, $number: Int!, $after: String) {
  repository(owner: $account, name: $name) {
    pullRequest(number: $number) {
      id url headRefOid
      commits(first: 100, after: $after) {
        totalCount nodes { commit { oid } } pageInfo { endCursor hasNextPage }
      }
    }
  }
}`;

const FIELDS = 'number,title,url,state,isDraft,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup';

export function isExternalReadName(name: string): name is ExternalReadName {
  return name === 'gh-pr-view' || name === 'gh-pr-commits';
}

/** Validate the whole argument before it reaches the fixed invocation, independently of its caller. */
function invocation(name: ExternalReadName, parameters: Readonly<Record<string, string>>): string[] {
  if (
    !isExternalReadName(name) ||
    typeof parameters.url !== 'string' ||
    Object.keys(parameters).some((key) => key !== 'url' && !(name === 'gh-pr-commits' && key === 'after'))
  )
    throw new ValidationError('Invalid external read or parameters');
  const url = parameters.url;
  if (
    url !== url.trim() ||
    !/^https:\/\/[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?\/[a-z0-9._][a-z0-9._-]*\/[a-z0-9._][a-z0-9._-]*\/pull\/[1-9][0-9]*\/?$/i.test(
      url,
    )
  )
    throw new ValidationError('External read requires an HTTPS pull request URL without credentials or extra parts');
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new ValidationError('External read URL has an invalid host');
  }
  if (parsed.pathname.split('/').some((part) => part === '.' || part === '..') || /\/(?:\.|\.\.)\//.test(url))
    throw new ValidationError('External read URL has an invalid path');
  if (parsed.hostname.split('.').some((part) => !part || part.startsWith('-') || part.endsWith('-')))
    throw new ValidationError('External read URL has an invalid host');
  if (name === 'gh-pr-view') return ['pr', 'view', url, '--json', FIELDS];
  const [, owner, repository, , number] = parsed.pathname.split('/');
  if (!number || !Number.isSafeInteger(Number(number)) || Number(number) > 2_147_483_647)
    throw new ValidationError('External read requires a supported PR number');
  if (parameters.after !== undefined && !/^[A-Za-z0-9+/_=-]{1,512}$/.test(parameters.after))
    throw new ValidationError('External read cursor is invalid');
  return [
    'api',
    'graphql',
    '--hostname',
    parsed.hostname,
    '-f',
    `query=${COMMITS_QUERY}`,
    '-f',
    `account=${owner}`,
    '-f',
    `name=${repository}`,
    '-F',
    `number=${number}`,
    ...(parameters.after === undefined ? [] : ['-f', `after=${parameters.after}`]),
  ];
}

export interface ExternalReads {
  readonly signal: AbortSignal;
  run(
    name: ExternalReadName,
    parameters: Readonly<Record<string, string>>,
    signal?: AbortSignal,
  ): Promise<ExternalReadResult>;
  dispose(): void;
}

/** One owner per loaded Plugin: two processes and at most eight waiting calls. */
export function createExternalReads(cwd: string): ExternalReads {
  const owner = new AbortController();
  let running = 0;
  const queue: (() => void)[] = [];
  const pump = () => {
    while (running < 2 && queue.length) queue.shift()?.();
  };
  return {
    signal: owner.signal,
    dispose: () => owner.abort(),
    async run(name, parameters, signal) {
      const args = invocation(name, parameters);
      const cancelled = AbortSignal.any([owner.signal, ...(signal ? [signal] : [])]);
      cancelled.throwIfAborted();
      if (running >= 2 && queue.length >= 8)
        throw new UsageError('External read queue is full; try again after the current reads finish');
      return new Promise<ExternalReadResult>((resolve, reject) => {
        const abort = () => {
          const index = queue.indexOf(start);
          if (index >= 0) queue.splice(index, 1);
          cancelled.removeEventListener('abort', abort);
          reject(cancelled.reason);
        };
        const start = () => {
          cancelled.removeEventListener('abort', abort);
          running++;
          void execute(cwd, args, cancelled)
            .then(resolve, reject)
            .finally(() => {
              running--;
              pump();
            });
        };
        cancelled.addEventListener('abort', abort, { once: true });
        if (running < 2) start();
        else queue.push(start);
      });
    },
  };
}

/** The executable and every option are fixed here. No shell, stdin, repository lookup or lock. */
function execute(cwd: string, args: string[], signal: AbortSignal): Promise<ExternalReadResult> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, {
      cwd,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GH_PROMPT_DISABLED: '1', GH_NO_UPDATE_NOTIFIER: '1', GH_PAGER: 'cat' },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let failed: unknown;
    let escalation: ReturnType<typeof setTimeout> | undefined;
    const stop = (reason: unknown) => {
      if (failed !== undefined) return;
      failed = reason;
      child.kill('SIGTERM');
      escalation = setTimeout(() => child.kill('SIGKILL'), 250);
      escalation.unref();
    };
    const abort = () => stop(signal.reason);
    const exit = () => child.kill('SIGKILL');
    const timer = setTimeout(
      () => stop(new UsageError('External read timed out after 10 seconds; try again later')),
      10_000,
    );
    timer.unref();
    signal.addEventListener('abort', abort, { once: true });
    process.once('exit', exit);
    const collect = (chunks: Buffer[], limit: number) => {
      let size = 0;
      return (chunk: Buffer) => {
        size += chunk.length;
        if (size > limit) stop(new UsageError('External read exceeded its output limit'));
        else if (failed === undefined) chunks.push(chunk);
      };
    };
    child.stdout.on('data', collect(stdout, 1024 * 1024));
    child.stderr.on('data', collect(stderr, 64 * 1024));
    child.on('error', (cause) => {
      failed = new UsageError('Cannot run gh for the external read', {
        cause,
        hint: 'install GitHub CLI and run gh auth login',
      });
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      clearTimeout(escalation);
      signal.removeEventListener('abort', abort);
      process.removeListener('exit', exit);
      if (failed !== undefined) reject(failed);
      else
        resolve({
          exitCode: code ?? 1,
          stdout: Buffer.concat(stdout).toString('utf8'),
          stderr: Buffer.concat(stderr).toString('utf8'),
        });
    });
  });
}
