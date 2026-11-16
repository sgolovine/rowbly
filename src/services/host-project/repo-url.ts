/** An scp-like Git URL, for example `git@github.com:o/r.git`. */
const SCP_URL = /^(?:[^@/]+@)?([^:/]+):(.+)$/;

/** A Git URL with a scheme, for example `ssh://git@github.com/o/r` or `https://github.com/o/r.git`. */
const SCHEME_URL = /^[a-z][a-z0-9+.-]*:\/\//i;

/** Removes the slashes at the two ends and a `.git` suffix. */
function trimRepoPath(path: string): string {
  return path
    .replace(/\/+$/, "")
    .replace(/\.git$/, "")
    .replace(/^\/+|\/+$/g, "");
}

function parsedUrl(url: string): URL | undefined {
  try {
    return new URL(url);
  } catch {
    return undefined;
  }
}

function schemeKey(url: string): string | undefined {
  const parsed = parsedUrl(url);

  return parsed && parsed.hostname !== "" ? `${parsed.hostname}/${trimRepoPath(parsed.pathname)}` : undefined;
}

/**
 * Gives the `host/owner/repo` form of a Git URL: lower case, without the user, the port, `.git` and the slashes at
 * the ends. A local path gives the path in the same form.
 */
export function normalizeRepoUrl(url: string): string {
  const text = url.trim().toLowerCase();
  const scp = SCHEME_URL.test(text) ? null : SCP_URL.exec(text);

  if (scp) {
    return `${scp[1]}/${trimRepoPath(scp[2] ?? "")}`;
  }

  return (SCHEME_URL.test(text) ? schemeKey(text) : undefined) ?? trimRepoPath(text);
}

/** `true` when the two Git URLs name the same repository, also in a different form (SSH or HTTPS). */
export function sameRepository(a: string, b: string): boolean {
  return normalizeRepoUrl(a) === normalizeRepoUrl(b);
}
