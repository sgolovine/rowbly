// Commits the canonical Project files. It never commits source files, the factory state or the runtime files.
// A problem gives a result, not an exception, because a commit problem must not stop the factory.
import { execFile } from "node:child_process";
import { realpath } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const CONFLICTS = new Set(["DD", "AU", "UD", "UA", "DU", "AA", "UU"]);
const DEFAULT_MESSAGE = "chore(rowbly): record project changes after scan";
const GIT_TIMEOUT_MS = 120_000;
const IDENTITY = /^([^<>\n]*[^<>\s])\s*<([^<>\s]+)>$/;
const LISTED_PATHS = 20;

/** The status is `committed`, `clean`, `held`, `conflict`, `no-git` or `failed`. */
export interface CommitResult {
  status: "committed" | "clean" | "held" | "conflict" | "no-git" | "failed";
  detail?: string;
  commit?: string;
  paths?: string[];
  held?: string[];
}

export interface CommitOptions {
  /** The subject of the commit. The default is `chore(rowbly): record project changes after scan`. */
  message?: string;
  /** The author and the committer, as `Name <email>`. Without it, the Git config sets the identity. */
  author?: string;
}

interface StatusRecord {
  code: string;
  path: string;
}

async function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string> {
  const options = { maxBuffer: 64 * 1024 * 1024, timeout: GIT_TIMEOUT_MS, ...(env ? { env } : {}) };

  return (await run("git", ["-C", cwd, ...args], options)).stdout;
}

function describe(error: unknown): string {
  const output = error as { stderr?: string; stdout?: string };

  return output.stderr?.trim() || output.stdout?.trim() || (error instanceof Error ? error.message : String(error));
}

/** The lock that all writers of the canonical Project files share. */
export async function lockPath(root: string): Promise<string> {
  try {
    const common = (await git(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])).trim();

    return join(common, "rowbly-project-write.lock");
  } catch {
    return resolve(root, ".rowbly-factory-write.lock");
  }
}

/**
 * The environment that sets the author and the committer of a `Name <email>` identity.
 * The environment overrides the Git config and the identity variables of the caller.
 */
function identityEnv(author: string | undefined): NodeJS.ProcessEnv | undefined | null {
  if (!author) {
    return undefined;
  }

  const match = IDENTITY.exec(author.trim());

  if (!match) {
    return null;
  }

  const name = (match[1] as string).trim();
  const email = match[2] as string;

  return {
    ...process.env,
    GIT_AUTHOR_NAME: name,
    GIT_AUTHOR_EMAIL: email,
    GIT_COMMITTER_NAME: name,
    GIT_COMMITTER_EMAIL: email,
  };
}

async function repositoryRoot(root: string): Promise<string | undefined> {
  try {
    return await realpath((await git(root, ["rev-parse", "--show-toplevel"])).trim());
  } catch {
    return undefined;
  }
}

/** Tells if Git never commits the path: the state file, its temporary files and the runtime folder. */
function isExcluded(project: string, path: string): boolean {
  return (
    path === `${project}/state.json` ||
    path.startsWith(`${project}/state.json.`) ||
    path === `${project}/runtime` ||
    path.startsWith(`${project}/runtime/`)
  );
}

/** The changed files of the Project. Without rename detection, a rename has separate old and new paths. */
async function changedFiles(repository: string, project: string): Promise<StatusRecord[]> {
  const status = await git(repository, [
    "-c",
    "status.renames=false",
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--",
    project,
  ]);

  return status
    .split("\0")
    .filter(Boolean)
    .map((record) => ({ code: record.slice(0, 2), path: record.slice(3) }))
    .filter(({ path }) => !isExcluded(project, path));
}

/** A file with a staged version and a later edit stays as it is. A commit would lose the staged version. */
function isHeld({ code }: StatusRecord): boolean {
  return !" ?".includes(code[0] as string) && code[1] !== " ";
}

function commitBody(paths: string[]): string {
  const more = paths.length > LISTED_PATHS ? `\nand ${paths.length - LISTED_PATHS} more` : "";

  return paths.slice(0, LISTED_PATHS).join("\n") + more;
}

async function commitChanges(
  repository: string,
  project: string,
  message: string,
  env: NodeJS.ProcessEnv | undefined,
): Promise<CommitResult> {
  const records = await changedFiles(repository, project);
  const conflicts = records.filter(({ code }) => CONFLICTS.has(code)).map(({ path }) => path);

  if (conflicts.length > 0) {
    return { status: "conflict", paths: conflicts, detail: "Resolve the merge conflict in these files." };
  }

  const held = records.filter(isHeld).map(({ path }) => path);
  const paths = records.filter((record) => !isHeld(record)).map(({ path }) => path);

  if (paths.length === 0) {
    return held.length > 0 ? { status: "held", held } : { status: "clean" };
  }

  const pathspec = ["--literal-pathspecs"];

  await git(repository, [...pathspec, "add", "--all", "--", ...paths]);
  await git(repository, [...pathspec, "commit", "--only", "-m", message, "-m", commitBody(paths), "--", ...paths], env);

  const commit = (await git(repository, ["rev-parse", "--short", "HEAD"])).trim();

  return { status: "committed", commit, paths, ...(held.length > 0 ? { held } : {}) };
}

/**
 * Commits each changed file of `<root>/.rowbly/` that Git does not ignore, except the state and the runtime files.
 * Call this only while the process holds the shared write lock of `lockPath`.
 */
export async function commitProjectFiles(root: string, options: CommitOptions = {}): Promise<CommitResult> {
  const env = identityEnv(options.author);

  if (env === null) {
    return { status: "failed", detail: `Use "Name <email>" for the author, not "${options.author}".` };
  }

  const repository = await repositoryRoot(root);

  if (!repository) {
    return { status: "no-git", detail: "The Project is not in a Git repository." };
  }

  try {
    const project = relative(repository, await realpath(resolve(root, ".rowbly")));

    return await commitChanges(repository, project, options.message ?? DEFAULT_MESSAGE, env);
  } catch (error) {
    return { status: "failed", detail: describe(error) };
  }
}
