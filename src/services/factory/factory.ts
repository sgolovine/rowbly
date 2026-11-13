import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { open, readdir, stat } from "node:fs/promises";
import { isAbsolute } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { ConflictError, ValidationError } from "../errors/errors.js";
import { publishCommand, readReceipt } from "../factoryControl/factoryControl.js";
import { type FactoryManager, getFactoryStatus as readStatus } from "../factoryManager/factoryManager.js";
import { type Owner, probeOwner, readFactoryOwner } from "../factoryOwnership/factoryOwnership.js";
import { prepareRuntime, runtimePath } from "../runtimeFiles/runtimeFiles.js";
import { getThread } from "../thread/thread.js";
import { findProject, type ServiceContext } from "../workspace/workspace.js";

export interface FactoryLaunch {
  executable: string;
  execArgv: string[];
  entry: string;
}
export type FactoryStatus = Partial<Omit<Awaited<ReturnType<FactoryManager["snapshot"]>>, "phase" | "owner">> & {
  version: number;
  phase: "starting" | "ready" | "stopping" | "stopped" | "failed" | "unavailable";
  owner?: Owner;
  liveness?: "alive" | "dead" | "uncertain";
  responsive?: boolean;
  error?: string;
  /** Queued work with its policy reasons: at most 50 Stories, without the Stories that wait for no worker. */
  queue?: FactoryQueueEntry[];
};
export interface FactoryQueueEntry {
  story: string;
  stage: string;
  action: "start" | "retry" | "skip";
  reason: string;
  retryAt?: string;
}
export async function getFactoryStatus(ctx: ServiceContext = {}): Promise<FactoryStatus> {
  const paths = await findProject(ctx);
  try {
    const owner = await readFactoryOwner(paths);
    const status = await readStatus(ctx);
    if (!owner) return { ...status, phase: status.phase === "failed" ? "failed" : "stopped", owner: undefined };
    const liveness = await probeOwner(owner);
    if (liveness === "dead") return { ...status, owner, phase: "stopped", liveness };
    if (status.owner?.token !== owner.token) return { version: 1, owner, phase: "starting", liveness };
    return { ...status, owner, liveness, responsive: Date.now() - Date.parse(status.heartbeatAt) < 15_000 };
  } catch (error) {
    return { version: 1, phase: "unavailable", error: error instanceof Error ? error.message : "Runtime unavailable" };
  }
}
export async function startFactory(
  input: { launch: FactoryLaunch; maxWorkers?: number; adoptExternal?: boolean; timeoutMs?: number },
  ctx: ServiceContext = {},
) {
  const paths = await findProject(ctx);
  await prepareRuntime(paths);
  const existing = await readFactoryOwner(paths);
  if (existing && (await probeOwner(existing)) === "uncertain")
    throw new ConflictError("Factory owner is uncertain; stop all factories before offline repair");
  let childError: string | undefined;
  let exited = false;
  if (!existing || (await probeOwner(existing)) === "dead") {
    const d = input.launch;
    if (!isAbsolute(d.executable) || !isAbsolute(d.entry))
      throw new ValidationError("Factory launch paths must be absolute");
    const execArgv: string[] = [];
    for (let index = 0; index < d.execArgv.length; index++) {
      const arg = d.execArgv[index];
      if (/^--(?:inspect|test|experimental-test)/.test(arg)) {
        if (
          !arg.includes("=") &&
          /^--(?:inspect-port|test-(?:name-pattern|skip-pattern|reporter|reporter-destination|concurrency|timeout|shard))$/.test(
            arg,
          )
        )
          index++;
        continue;
      }
      execArgv.push(arg);
    }
    const logPath = await runtimePath(paths, `logs/${randomUUID()}.jsonl`);
    const log = await open(logPath, "a", 0o600);
    try {
      const child = spawn(
        d.executable,
        [
          ...execArgv,
          d.entry,
          "-C",
          paths.root,
          "factory",
          "run",
          ...(input.maxWorkers !== undefined ? ["--max-workers", String(input.maxWorkers)] : []),
          ...(input.adoptExternal ? ["--adopt-external"] : []),
        ],
        {
          cwd: paths.root,
          detached: true,
          stdio: ["ignore", log.fd, log.fd],
          windowsHide: true,
        },
      );
      child.on("error", (error) => {
        childError = error.message;
      });
      child.on("exit", () => {
        exited = true;
      });
      child.unref();
    } finally {
      await log.close();
    }
  }
  const deadline = Date.now() + (input.timeoutMs ?? 15_000);
  while (Date.now() < deadline) {
    const status = await getFactoryStatus(ctx);
    if (status.phase === "ready" && status.liveness === "alive" && status.owner)
      return { ...status, owner: status.owner };
    if (childError) throw new ConflictError(`Factory launch failed: ${childError}`);
    if (exited && (!status.owner || status.liveness === "dead")) {
      const logs = await getFactoryLogs({ tail: 10 }, ctx);
      throw new ConflictError(`Factory exited before ready. ${logs.lines.join("\n")}`);
    }
    await sleep(50);
  }
  throw new ConflictError("Factory readiness timed out; inspect factory status and logs before another start");
}
export async function sendFactoryCommand(
  type: "stop" | "cancel" | "resume",
  input: { threadId?: string; timeoutMs?: number } = {},
  ctx: ServiceContext = {},
) {
  const paths = await findProject(ctx);
  const owner = await readFactoryOwner(paths);
  if (!owner || (await probeOwner(owner)) !== "alive")
    throw new ConflictError("Factory is not running", {
      hint: "Run rowbly factory start, then send the command again.",
    });
  const thread = input.threadId ? await getThread(input.threadId, ctx) : undefined;
  const command = await publishCommand(paths, {
    targetOwnerToken: owner.token,
    type,
    threadId: thread?.id,
    expectedRunId: thread?.runs.at(-1)?.id,
  });
  const deadline = Date.now() + (input.timeoutMs ?? 30_000);
  while (Date.now() < deadline) {
    const receipt = await readReceipt(paths, command.id);
    if (receipt?.status === "rejected") throw new ConflictError(receipt.error?.message ?? "Factory command rejected");
    if (receipt?.status === "completed") {
      if (type !== "stop" || (await readFactoryOwner(paths))?.token !== owner.token) return receipt;
    }
    await sleep(50);
  }
  throw new ConflictError(`Factory command timed out: ${command.id}`);
}
export async function stopFactory(input: { timeoutMs?: number } = {}, ctx: ServiceContext = {}) {
  const status = await getFactoryStatus(ctx);
  if (status.phase === "stopped" || (status.phase === "failed" && !status.owner)) return { phase: "stopped" };
  return sendFactoryCommand("stop", input, ctx);
}
export async function restartFactory(input: Parameters<typeof startFactory>[0], ctx: ServiceContext = {}) {
  await stopFactory({ timeoutMs: input.timeoutMs }, ctx);
  return startFactory(input, ctx);
}
export async function getFactoryLogs(input: { tail?: number } = {}, ctx: ServiceContext = {}) {
  const tail = input.tail ?? 20;
  if (!Number.isInteger(tail) || tail < 1 || tail > 1000) throw new ValidationError("Log tail must be from 1 to 1000");
  const paths = await findProject(ctx);
  const dir = await runtimePath(paths, "logs");
  const files = await readdir(dir).catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return [];
    throw e;
  });
  const ordered = await Promise.all(
    files
      .filter((f) => /^[\w-]+\.jsonl$/.test(f))
      .map(async (f) => ({ f, time: (await stat(await runtimePath(paths, `logs/${f}`))).mtimeMs })),
  );
  const lines: string[] = [];
  for (const { f } of ordered.sort((a, b) => a.time - b.time).slice(-4)) {
    const file = await open(await runtimePath(paths, `logs/${f}`), "r");
    try {
      const size = (await file.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, 64 * 1024));
      await file.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      lines.push(
        ...buffer
          .toString("utf8")
          .split("\n")
          .filter(Boolean)
          .slice(size > buffer.length ? 1 : 0),
      );
    } finally {
      await file.close();
    }
  }
  return { lines: lines.slice(-tail) };
}
