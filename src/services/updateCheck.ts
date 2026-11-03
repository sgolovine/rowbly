/** The npm manifest of the `latest` release of Rowbly (ADR-0049 §1). */
export const LATEST_RELEASE_URL = 'https://registry.npmjs.org/rowbly/latest';

/** How long the check may take before it gives up. */
const TIMEOUT_MS = 3000;

const RELEASE = /^(\d+)\.(\d+)\.(\d+)$/;

export interface UpdateCheckOptions {
  /** Ends the check early, for example when the TUI quits. */
  signal?: AbortSignal;
  url?: string;
  fetch?: typeof fetch;
}

/**
 * The version of the latest Rowbly release on npm when it is newer than `current`, otherwise
 * `null`. Never rejects: being offline, a slow or failing registry, an unexpected answer and an
 * aborted check all give `null`, so nothing is shown (ADR-0049 §2).
 */
export async function newerRelease(current: string, options: UpdateCheckOptions = {}): Promise<string | null> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  try {
    const response = await (options.fetch ?? fetch)(options.url ?? LATEST_RELEASE_URL, {
      signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) return null;
    const { version } = (await response.json()) as { version?: unknown };
    return typeof version === 'string' && isNewer(version, current) ? version : null;
  } catch {
    return null;
  }
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
