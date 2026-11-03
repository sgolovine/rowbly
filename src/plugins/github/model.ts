import { ValidationError, z } from '../../plugin-api';

/** Check raw segments before URL parsing can normalize a dot segment or encoded path. */
export function parsePrUrl(value: string): string {
  const match =
    /^https:\/\/([a-z0-9](?:[a-z0-9.-]*[a-z0-9])?)\/([a-z0-9._][a-z0-9._-]*)\/([a-z0-9._][a-z0-9._-]*)\/pull\/([1-9][0-9]*)\/?$/i.exec(
      value,
    );
  const invalid = () =>
    new ValidationError(
      'GitHub PR must be an HTTPS URL like https://github.com/octo/name/pull/123, without credentials or extra parts',
    );
  if (
    value !== value.trim() ||
    !match ||
    match[2] === '.' ||
    match[2] === '..' ||
    match[3] === '.' ||
    match[3] === '..'
  )
    throw invalid();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw invalid();
  }
  if (url.hostname.split('.').some((part) => !part || part.startsWith('-') || part.endsWith('-'))) throw invalid();
  return `https://${url.hostname}/${match[2]}/${match[3]}/pull/${match[4]}`;
}

const PrUrl = z.string().transform((value, ctx) => {
  try {
    return parsePrUrl(value);
  } catch (error) {
    ctx.addIssue({ code: 'custom', message: error instanceof Error ? error.message : 'Invalid GitHub PR URL' });
    return z.NEVER;
  }
});

/** Unversioned v1. Unknown keys/versions are opaque; no ordinary edit repairs or resets them. */
export const GitHubBag = z.strictObject({ pr: PrUrl });
export const GitHubInput = z.strictObject({ pr: PrUrl.nullable() });
