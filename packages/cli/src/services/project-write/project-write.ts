import { formatAuthor, type GitSettings } from "../factory-settings/git-settings.js";
import { withFileLock } from "../file-lock/file-lock.js";
import { type CommitResult, commitProjectFiles, lockPath } from "./project-commit.js";

/** The shared write lock in the Git common directory, or next to a Project without Git. */
export async function projectWriteLockPath(root: string): Promise<string> {
  return lockPath(root);
}

/** Holds the shared kernel lock of the Project while `action` runs. Parent exit releases the lock through EOF. */
export async function projectWrite<T>(root: string, action: () => Promise<T>, waitSeconds = 60): Promise<T> {
  return withFileLock(await projectWriteLockPath(root), action, { waitSeconds, label: "Project write lock" });
}

/** Commits canonical files while projectWrite holds the shared kernel lock. The Git settings set the message and the author. */
export async function commitCanonicalProject(root: string, git?: GitSettings): Promise<CommitResult> {
  const options = { message: git?.commitMessage || undefined, author: formatAuthor(git) };

  return projectWrite(root, () => commitProjectFiles(root, options));
}
