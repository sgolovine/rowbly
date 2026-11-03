import { Resolver } from 'node:dns';
import { get as httpGet } from 'node:http';
import { globalAgent, get as httpsGet } from 'node:https';
import type { LookupFunction } from 'node:net';

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
 * The `version` of the manifest at `url`. Everything the check holds is its own and ends with it:
 * the socket and timer are unreferenced, and the timeout and `signal` destroy the request and
 * cancel its DNS query, so a check still running never keeps Rowbly from exiting (ADR-0049 §2).
 */
function latestRelease({ signal, url = LATEST_RELEASE_URL }: UpdateCheckOptions): Promise<string | null> {
  return new Promise((resolve) => {
    if (signal?.aborted || proxyRouted()) return resolve(null);
    let settled = false;
    const finish = (version: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', stop);
      request.destroy();
      resolver.cancel();
      resolve(version);
    };
    const stop = () => finish(null);
    // `dns.lookup` cannot be cancelled, so a DNS server that never answers would hold the process.
    const resolver = new Resolver({ timeout: TIMEOUT_MS, tries: 1 });
    const get = url.startsWith('http:') ? httpGet : httpsGet;
    const options = { headers: { accept: 'application/json' }, lookup: cancellableLookup(resolver) };
    const request = get(url, options, (response) => {
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

/**
 * Whether Node sends HTTPS requests through a proxy from the environment (`NODE_USE_ENV_PROXY=1`
 * or `--use-env-proxy` with `HTTPS_PROXY`). Its CONNECT tunnel cannot be cancelled, so the check is
 * skipped rather than risk delaying exit (ADR-0049 §2).
 */
function proxyRouted(): boolean {
  const env = (globalAgent.options as { proxyEnv?: NodeJS.ProcessEnv }).proxyEnv;
  return Boolean(env?.HTTPS_PROXY || env?.https_proxy);
}

/** A `lookup` that resolves through `resolver`, IPv4 first, so the query ends when it is cancelled. */
function cancellableLookup(resolver: Resolver): LookupFunction {
  return (hostname, options, callback) => {
    const answer = (addresses: string[], family: 4 | 6) => {
      const all = addresses.map((address) => ({ address, family }));
      if (options.all) callback(null, all);
      else callback(null, addresses[0] as string, family);
    };
    resolver.resolve4(hostname, (err4, v4) => {
      if (!err4 && v4.length > 0) return answer(v4, 4);
      // Only a name without IPv4 addresses tries IPv6; a cancelled or failed query ends here.
      if (err4 && err4.code !== 'ENODATA') return callback(err4, '', 4);
      resolver.resolve6(hostname, (err6, v6) => {
        if (!err6 && v6.length > 0) answer(v6, 6);
        else callback(err6 ?? err4 ?? new Error(`no address for ${hostname}`), '', 4);
      });
    });
  };
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
