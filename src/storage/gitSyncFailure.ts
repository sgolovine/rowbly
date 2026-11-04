/**
 * Why a Git synchronization failed, as a stable value scripts and agents can act on (ADR-0058 §2):
 * - `capture-changed`: another writer, such as the TUI, kept saving Rowbly data (retryable);
 * - `index-changed`: another Git command changed the staged files during Sync (retryable);
 * - `network`: fetch or push failed; the local result is kept (retryable);
 * - `resolution-off`: Automatic Merge Conflict Resolution is Off in this checkout;
 * - `no-upstream`: no checked-out branch, or it has no configured Git upstream;
 * - `conflict`: a Git state or conflict that needs a person, such as non-Rowbly conflicts;
 * - `evidence`: Merge Evidence disagrees and needs review;
 * - `unexpected`: anything else.
 */
export type GitSyncReason =
  | 'capture-changed'
  | 'index-changed'
  | 'network'
  | 'resolution-off'
  | 'no-upstream'
  | 'conflict'
  | 'evidence'
  | 'unexpected';

const RETRYABLE: ReadonlySet<GitSyncReason> = new Set(['capture-changed', 'index-changed', 'network']);

/** A Git synchronization failure with its reason and the paths it concerns. */
export class GitSyncFailure extends Error {
  readonly retryable: boolean;
  constructor(
    readonly reason: GitSyncReason,
    message: string,
    readonly paths: readonly string[] = [],
  ) {
    super(message);
    this.retryable = RETRYABLE.has(reason);
  }
}

/** The reason of a thrown value; a failure that names none is `unexpected`. */
export function syncFailureReason(err: unknown): GitSyncReason {
  return err instanceof GitSyncFailure ? err.reason : 'unexpected';
}

export function retryableReason(reason: GitSyncReason): boolean {
  return RETRYABLE.has(reason);
}

/** Paths as people know them: a Story's files become its Story Key; at most ten are named. */
export function describePaths(paths: readonly string[]): string {
  const names = [...new Set(paths.map((path) => /(?:^|\/)stories\/([^/]+)\//.exec(path)?.[1] ?? path))];
  return names.length > 10 ? `${names.slice(0, 10).join(', ')} and ${names.length - 10} more` : names.join(', ');
}
