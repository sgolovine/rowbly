import { readFile, rm } from "node:fs/promises";
import { writeFileAtomic } from "../files/files.js";
import { mapInOrder } from "../in-order/in-order.js";
import { runtimePath } from "../runtime-files/runtime-files.js";
import type { ProjectPaths } from "../workspace/workspace.js";
import { isFinalCheck } from "./check-order.js";
import type { CheckJob } from "./check-types.js";

/** The queue keeps the records and the logs of the last 500 jobs. */
export const KEPT_JOBS = 500;

const JOBS_FILE = "checks/jobs.json";

function isJob(value: unknown): value is CheckJob {
  const job = value as CheckJob;

  return (
    !!job &&
    typeof job.id === "string" &&
    /^[A-Za-z0-9_-]{1,128}$/.test(job.id) &&
    typeof job.key === "string" &&
    typeof job.status === "string"
  );
}

/** Gives the path of the log of a job. */
export function checkLogPath(paths: ProjectPaths, id: string): Promise<string> {
  return runtimePath(paths, `checks/${id}.log`);
}

/** Reads the job records. An absent or invalid file gives no records. */
export async function readCheckJobs(paths: ProjectPaths): Promise<readonly CheckJob[]> {
  try {
    const stored = JSON.parse(await readFile(await runtimePath(paths, JOBS_FILE), "utf8"));

    return Array.isArray(stored?.jobs) ? stored.jobs.filter(isJob) : [];
  } catch {
    return [];
  }
}

/** Gives the records to keep: all active jobs, and the last final jobs up to the limit. */
export function keptJobs(jobs: readonly CheckJob[]): readonly CheckJob[] {
  const final = jobs.filter((job) => isFinalCheck(job.status));
  const dropped = new Set(final.slice(0, Math.max(0, jobs.length - KEPT_JOBS)).map((job) => job.id));

  return jobs.filter((job) => !dropped.has(job.id));
}

/** Writes the kept records, and removes the logs of the dropped records. */
export async function writeCheckJobs(
  paths: ProjectPaths,
  kept: readonly CheckJob[],
  dropped: readonly CheckJob[],
): Promise<void> {
  await writeFileAtomic(await runtimePath(paths, JOBS_FILE), `${JSON.stringify({ version: 1, jobs: kept })}\n`, {
    mode: 0o600,
  });
  await mapInOrder(dropped, async (job) => rm(await checkLogPath(paths, job.id), { force: true }));
}
