import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import pkg from "../../../package.json" with { type: "json" };
import { ValidationError } from "../errors/errors.js";
import { packageDir, pathExists } from "../files/files.js";

/** The build of Rowbly on the main machine. A worker host must run the same build. */
export interface LocalBuild {
  /** `<version>` for a released build, `<version>-dev-<hash>` for an unreleased build. */
  readonly id: string;
  /** The version of `package.json`. `rowbly --version` prints it. */
  readonly version: string;
  /** `true` for a build from npm. */
  readonly released: boolean;
  /** Gives the bytes of the package of an unreleased build. A released build has no package. */
  readonly pack?: () => Promise<Buffer>;
}

/** The parts of the environment of `localBuild`. Tests replace them. */
export interface LocalBuildDeps {
  readonly packageDir: () => Promise<string>;
  readonly modulePath: string;
  readonly version: string;
  /** Makes the package of the folder and gives its bytes. */
  readonly pack: (dir: string) => Promise<Buffer>;
}

/** The characters that a build id can have. They are safe in a remote command token. */
const SAFE_BUILD_ID = /^[A-Za-z0-9._-]+$/;

/** The number of hex characters of the package hash in an unreleased build id. */
const HASH_LENGTH = 12;

const PACK_TIMEOUT_MS = 5 * 60_000;

const run = promisify(execFile);

/** Refuses a build id that is not safe in a remote path, for example a version with `+`. */
export function validateBuildId(id: string): void {
  if (!SAFE_BUILD_ID.test(id)) {
    throw new ValidationError(`The Rowbly build id ${JSON.stringify(id)} cannot go to a worker host.`, {
      details: { issues: [{ path: ["version"], message: "Use only A-Z, a-z, 0-9 and . _ - in the version." }] },
      hint: "Use a version without + or other special characters.",
    });
  }
}

/** Gives the id of an unreleased build: the version and the first 12 hex characters of the sha256 of the package. */
export function devBuildId(version: string, bytes: Buffer): string {
  return `${version}-dev-${createHash("sha256").update(bytes).digest("hex").slice(0, HASH_LENGTH)}`;
}

/**
 * An unreleased build has its sources (`src/cli.ts`), or runs from `src/`.
 * A package from npm has only `src/config/prompts/`.
 */
async function isUnreleased(dir: string, modulePath: string): Promise<boolean> {
  return (await pathExists(join(dir, "src", "cli.ts"))) || relative(dir, modulePath).startsWith(`src${sep}`);
}

async function assertBuilt(dir: string): Promise<void> {
  if (!(await pathExists(join(dir, "dist", "cli.js")))) {
    throw new ValidationError("The unreleased Rowbly build has no dist/cli.js.", {
      details: { packageDir: dir },
      hint: "Run pnpm build",
    });
  }
}

/** Runs `npm pack` in the folder without scripts and without a shell, and gives the bytes of the package. */
export async function npmPack(dir: string): Promise<Buffer> {
  const destination = await mkdtemp(join(tmpdir(), "rowbly-pack-"));

  try {
    const { stdout } = await run("npm", ["pack", "--ignore-scripts", "--json", "--pack-destination", destination], {
      cwd: dir,
      shell: false,
      timeout: PACK_TIMEOUT_MS,
      maxBuffer: 16 * 1024 * 1024,
    });
    const [entry] = JSON.parse(stdout) as { filename: string }[];

    return await readFile(join(destination, entry?.filename ?? ""));
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
}

function defaultDeps(): LocalBuildDeps {
  return { packageDir, modulePath: fileURLToPath(import.meta.url), version: pkg.version, pack: npmPack };
}

/** Gives the build of the main machine. An unreleased build runs `npm pack` one time to get its id. */
export async function localBuild(deps: LocalBuildDeps = defaultDeps()): Promise<LocalBuild> {
  const dir = await deps.packageDir();
  const { version } = deps;

  validateBuildId(version);

  if (!(await isUnreleased(dir, deps.modulePath))) {
    return { id: version, version, released: true };
  }

  await assertBuilt(dir);

  const bytes = await deps.pack(dir);
  const id = devBuildId(version, bytes);

  validateBuildId(id);

  return { id, version, released: false, pack: () => Promise.resolve(bytes) };
}
