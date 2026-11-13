import { watch } from "node:fs";
import { appendFile, chmod, readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { ValidationError } from "../../services/errors/errors.js";
import { processCommands, pruneFactoryCommands } from "../../services/factory-control/factory-control.js";
import { createFactoryManager } from "../../services/factory-manager/factory-manager.js";
import {
  acquireFactoryOwnership,
  newOwner,
  probeOwner,
  readFactoryOwner,
  releaseFactoryOwnership,
} from "../../services/factory-ownership/factory-ownership.js";
import { preflightFactory, recoverFactory } from "../../services/factory-recovery/factory-recovery.js";
import { writeFileAtomic } from "../../services/files/files.js";
import { createFactoryRuntime } from "../../services/pi-runtime/factory-runtime.js";
import { prepareRuntime, runtimePath } from "../../services/runtime-files/runtime-files.js";
import { bundledSkills } from "../../services/skill/skill.js";
import { findProject, type ServiceContext } from "../../services/workspace/workspace.js";

export interface LaunchDescriptor {
  executable: string;
  execArgv: string[];
  entry: string;
}
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export async function createCliShim(descriptor: LaunchDescriptor, ctx: ServiceContext = {}) {
  if (!isAbsolute(descriptor.entry) || !isAbsolute(descriptor.executable)) {
    throw new ValidationError("CLI launch paths must be absolute");
  }
  const paths = await findProject(ctx);
  await prepareRuntime(paths);
  const shim = await runtimePath(paths, "bin/rowbly");
  const command = [descriptor.executable, ...descriptor.execArgv, descriptor.entry].map(shellQuote).join(" ");
  await writeFileAtomic(
    shim,
    `#!/bin/sh\nif [ "$#" -eq 0 ] && [ ! -t 0 ]; then\n  echo 'Rowbly factory CLI requires a command' >&2\n  exit 1\nfi\nexec ${command} "$@"\n`,
    { mode: 0o700, durable: true },
  );
  await chmod(shim, 0o700);
  return shim;
}
/** Owns process signals and output. Services contain no process handlers. */
export async function runFactoryForeground(
  input: { maxWorkers?: number; adoptExternal?: boolean },
  ctx: ServiceContext = {},
) {
  const paths = await findProject(ctx);
  await preflightFactory(ctx);
  const previous = await readFactoryOwner(paths);
  const owner = await newOwner();
  if (!(await acquireFactoryOwnership(paths, owner)).acquired) {
    return { phase: "already-running" };
  }
  const deadToken = previous && (await probeOwner(previous)) === "dead" ? previous.token : undefined;
  const statusPath = await runtimePath(paths, "status.json");
  const priorStatus = await readFile(statusPath, "utf8").then(
    (text) => {
      try {
        return JSON.parse(text);
      } catch {
        return {};
      }
    },
    () => ({}),
  );
  try {
    await writeFileAtomic(
      statusPath,
      `${JSON.stringify({ ...priorStatus, version: 1, owner, phase: "starting", heartbeatAt: new Date().toISOString() })}\n`,
      { mode: 0o600, durable: true },
    );
    await recoverFactory(owner.token, deadToken, !!input.adoptExternal, ctx);
    await pruneFactoryCommands(
      paths,
      [owner.token, previous?.token ?? priorStatus.owner?.token].filter(
        (token): token is string => typeof token === "string",
      ),
    );
    const { runtime, agentDir } = await createFactoryRuntime();
    const shim = await createCliShim(
      { executable: process.execPath, execArgv: process.execArgv, entry: resolve(process.argv[1] as string) },
      ctx,
    );
    const manager = await createFactoryManager(
      {
        runtime,
        ownership: { owner, deadToken },
        adoptExternal: input.adoptExternal,
        agentDir,
        shim,
        skillsDir: (await bundledSkills(ctx)).dir,
        maxWorkers: input.maxWorkers,
        onModel: (role, model) => console.error(`${role}: ${model.provider}/${model.modelId}`),
      },
      ctx,
    );
    const log = await runtimePath(paths, `logs/${owner.token}.jsonl`);
    await appendFile(
      log,
      `${JSON.stringify({ event: "starting", at: new Date().toISOString(), ownerToken: owner.token })}\n`,
      { mode: 0o600 },
    );
    let controlQueue = Promise.resolve();
    let polling = false;
    const poll = () => {
      if (polling) {
        return;
      }
      polling = true;
      controlQueue = controlQueue
        .then(() =>
          processCommands(paths, owner.token, async (command) => {
            if (command.type === "stop") {
              await manager.shutdown();
            } else {
              if (!command.threadId || !command.expectedRunId) {
                throw new ValidationError("Thread and run IDs are necessary");
              }
              if (command.type === "cancel") {
                await manager.cancelWorker(command.threadId, command.expectedRunId);
              } else {
                await manager.resumeWorker(command.threadId, command.expectedRunId, command.id);
              }
            }
          }),
        )
        .catch((error) => {
          console.error(error instanceof Error ? error.message : "Control scan failed");
        })
        .finally(() => {
          polling = false;
        });
    };
    const controlWatch = watch(await runtimePath(paths, "control"), poll);
    const timer = setInterval(poll, 1000);
    poll();
    const stop = () => {
      void manager.shutdown();
    };
    process.on("SIGINT", stop);
    process.on("SIGTERM", stop);
    try {
      await manager.run();
    } finally {
      clearInterval(timer);
      controlWatch.close();
      await controlQueue;
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await manager.shutdown();
      await runtime.settleCredentialWrites();
    }
    await appendFile(log, `${JSON.stringify({ event: "stopped", at: new Date().toISOString() })}\n`);
    return { phase: "stopped" };
  } catch (error) {
    await writeFileAtomic(
      statusPath,
      `${JSON.stringify({ version: 1, owner, phase: "failed", error: error instanceof Error ? error.message.slice(0, 1000) : "Factory failed" })}\n`,
      { mode: 0o600, durable: true },
    );
    throw error;
  } finally {
    await releaseFactoryOwnership(paths, owner.token);
  }
}
