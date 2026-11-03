import { get as httpGet } from 'node:http';
import { get as httpsGet } from 'node:https';

/** The npm manifest of the `latest` release of Rowbly (ADR-0049 §1). */
export const LATEST_RELEASE_URL = 'https://registry.npmjs.org/rowbly/latest';

/** How long the check may take before it gives up. */
const TIMEOUT_MS = 3000;

/** The manifest is about 2 KB; a longer answer is not one. */
const MAX_BYTES = 64 * 1024;

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;

export interface UpdateCheckOptions {
  /** Ends the check early, for example when the TUI quits. */
  signal?: AbortSignal;
  url?: string;
}

/**
 * The version of the latest Rowbly release on npm when it is newer than `current`, otherwise
 * `null`. Never rejects: being offline, a slow or failing registry, an unexpected answer and an
 * aborted check all give `null`, so nothing is shown (ADR-0049 §2).
 */
export async function newerRelease(current: string, options: UpdateCheckOptions = {}): Promise<string | null> {
  const latest = await latestRelease(options);
  return latest !== null && isNewer(latest, current) ? latest : null;
}

/**
 * The `version` of the manifest at `url`. Its socket and timer are unreferenced, so a check still
 * running never keeps Rowbly from exiting; the timeout and `signal` destroy the request.
 */
function latestRelease({ signal, url = LATEST_RELEASE_URL }: UpdateCheckOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve(null);
    let settled = false;
    const finish = (version: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      request.destroy();
      resolve(version);
    };
    const stop = () => finish(null);
    const get = url.startsWith('http:') ? httpGet : httpsGet;
    const request = get(url, { headers: { accept: 'application/json' } }, (response) => {
      if (response.statusCode !== 200) return stop();
      let body = '';
      response.setEncoding('utf8');
      response.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > MAX_BYTES) stop();
      });
      response.on('end', () => {
        try {
          const { version } = JSON.parse(body) as { version?: unknown };
          finish(typeof version === 'string' ? version : null);
        } catch {
          stop();
        }
      });
      response.on('error', stop);
    });
    request.on('socket', (socket) => socket.unref());
    request.on('error', stop);
    const timer = setTimeout(stop, TIMEOUT_MS);
    timer.unref();
    signal?.addEventListener('abort', stop, { once: true });
  });
}

/** Whether release `latest` is newer than `current`; a prerelease or any other form is never newer. */
function isNewer(latest: string, current: string): boolean {
  const next = RELEASE.exec(latest);
  if (!next) return false;
  const now = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
  if (!now) return false;
  for (let i = 1; i <= 3; i++) {
    const diff = Number(next[i]) - Number(now[i]);
    if (diff !== 0) return diff > 0;
  }
  // Same release: a prerelease of it is older than the release itself.
  return current.length > now[0].length;
}
