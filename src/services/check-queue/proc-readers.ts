import { execFile, spawn } from "node:child_process";
import { readdir, readFile } from "node:fs/promises";
import { promisify } from "node:util";
import type { CheckProcess, CheckQueueDeps, ShellEnv } from "./check-types.js";

const exec = promisify(execFile);

/** The field after the command name in `/proc/<pid>/stat`: state is field 3, so pgrp (5) is index 2. */
const PGRP_INDEX = 2;
/** The start time is field 22 of `/proc/<pid>/stat`. */
const START_INDEX = 19;

export const DEFAULT_TIMING = {
  sampleMs: 1000,
  admitMs: 5000,
  progressMs: 10_000,
  killGraceMs: 5000,
  minuteMs: 60_000,
};

/** Gives the fields after the command name. The name can have spaces and parentheses, so split after the last `)`. */
async function statFields(pid: number): Promise<readonly string[] | undefined> {
  const text = await readFile(`/proc/${pid}/stat`, "utf8").catch(() => undefined);

  return text?.slice(text.lastIndexOf(")") + 2).split(" ");
}

/** Reads `MemAvailable` from `/proc/meminfo`, in MB. */
export async function readMemAvailableMb(): Promise<number> {
  const text = await readFile("/proc/meminfo", "utf8");
  const kb = Number(/^MemAvailable:\s+(\d+)\s+kB$/m.exec(text)?.[1]);

  if (!Number.isFinite(kb)) {
    throw new Error("MemAvailable is not in /proc/meminfo");
  }

  return Math.floor(kb / 1024);
}

/** Gives the Linux start ticks of a process, or undefined when it does not exist. */
export async function readStartTicks(pid: number): Promise<string | undefined> {
  return (await statFields(pid))?.[START_INDEX];
}

async function rssKb(pid: number, pgid: number): Promise<number> {
  if ((await statFields(pid))?.[PGRP_INDEX] !== String(pgid)) {
    return 0;
  }

  const status = await readFile(`/proc/${pid}/status`, "utf8").catch(() => "");

  return Number(/^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1] ?? 0);
}

/** Adds the RSS of all processes in a process group, from `/proc/<pid>/status`, in MB. */
export async function readGroupRssMb(pgid: number): Promise<number> {
  const pids = (await readdir("/proc")).filter((name) => /^\d+$/.test(name)).map(Number);
  const sizes = await Promise.all(pids.map((pid) => rssKb(pid, pgid)));

  return Math.ceil(sizes.reduce((sum, size) => sum + size, 0) / 1024);
}

/** Sends a signal to a process group. A group that does not exist is not an error. */
export function killGroup(pgid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") {
      throw error;
    }
  }
}

/** Reads the Git `HEAD` of a worktree, or undefined. */
export async function readHead(cwd: string): Promise<string | undefined> {
  return exec("git", ["-C", cwd, "rev-parse", "HEAD"]).then(
    ({ stdout }) => stdout.trim() || undefined,
    () => undefined,
  );
}

/**
 * Starts a check through `bash -c` in its own process group. When the leader exits, the group gets SIGKILL,
 * so that no child of the check stays alive and keeps the output open.
 */
export function spawnCheck(command: string, options: { cwd: string; env: ShellEnv }): CheckProcess {
  const child = spawn("bash", ["-c", command], {
    cwd: options.cwd,
    env: options.env,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const exited = new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", () => child.pid && killGroup(child.pid, "SIGKILL"));
    child.once("close", (code) => resolve(code));
  });

  return {
    pid: child.pid,
    exited,
    onOutput: (listener) => {
      child.stdout?.setEncoding("utf8").on("data", listener);
      child.stderr?.setEncoding("utf8").on("data", listener);
    },
  };
}

/** The real readers, spawn, signals and clock of the queue. */
export function realCheckDeps(): CheckQueueDeps {
  return {
    readMemAvailableMb,
    readGroupRssMb,
    readStartTicks,
    readHead,
    spawn: spawnCheck,
    kill: killGroup,
    now: Date.now,
    timing: DEFAULT_TIMING,
  };
}
