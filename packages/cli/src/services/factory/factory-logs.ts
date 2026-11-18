import { open, readdir, stat } from "node:fs/promises";
import { ValidationError } from "../errors/errors.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import { findProject, type ProjectPaths, type ServiceContext } from "../workspace/workspace.js";

/** The bytes at the end of each log file that a read takes. */
const TAIL_BYTES = 64 * 1024;

async function listLogFiles(dir: string): Promise<string[]> {
  return readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") {
      return [];
    }

    throw e;
  });
}

/** Gives the complete lines in the last 64 KiB of a log file. A cut first line is left out. */
async function readLogTail(paths: ProjectPaths, name: string): Promise<string[]> {
  const file = await open(await runtimePath(paths, `logs/${name}`), "r");

  try {
    const size = (await file.stat()).size;
    const buffer = Buffer.alloc(Math.min(size, TAIL_BYTES));

    await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));

    return buffer
      .toString("utf8")
      .split("\n")
      .filter(Boolean)
      .slice(size > buffer.length ? 1 : 0);
  } finally {
    await file.close();
  }
}

/** Reads the files one at a time, in order, so that at most one file is open. */
async function readLogTails(paths: ProjectPaths, names: readonly string[]): Promise<string[]> {
  const [first, ...rest] = names;

  if (first === undefined) {
    return [];
  }

  const lines = await readLogTail(paths, first);

  return [...lines, ...(await readLogTails(paths, rest))];
}

/** Reads the last lines of the four newest operational logs. */
export async function getFactoryLogs(input: { tail?: number } = {}, ctx: ServiceContext = {}) {
  const tail = input.tail ?? 20;

  if (!Number.isInteger(tail) || tail < 1 || tail > 1000) {
    throw new ValidationError("Log tail must be from 1 to 1000");
  }

  const paths = await findProject(ctx);
  const dir = await runtimePath(paths, "logs");
  const files = await listLogFiles(dir);
  const ordered = await Promise.all(
    files
      .filter((f) => /^[\w-]+\.jsonl$/.test(f))
      .map(async (f) => ({ f, time: (await stat(await runtimePath(paths, `logs/${f}`))).mtimeMs })),
  );

  const newest = ordered
    .toSorted((a, b) => a.time - b.time)
    .slice(-4)
    .map(({ f }) => f);
  const lines = await readLogTails(paths, newest);

  return { lines: lines.slice(-tail) };
}
