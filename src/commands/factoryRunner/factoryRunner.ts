import { chmod } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";
import { ValidationError } from "../../services/errors/errors.js";
import { createFactoryManager } from "../../services/factoryManager/factoryManager.js";
import { writeFileAtomic } from "../../services/files/files.js";
import { createFactoryRuntime } from "../../services/piRuntime/factoryRuntime.js";
import { prepareRuntime, runtimePath } from "../../services/runtimeFiles/runtimeFiles.js";
import { bundledSkills } from "../../services/skill/skill.js";
import { findProject, type ServiceContext } from "../../services/workspace/workspace.js";

export interface LaunchDescriptor {
  executable: string;
  execArgv: string[];
  entry: string;
}
export const shellQuote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
export async function createCliShim(descriptor: LaunchDescriptor, ctx: ServiceContext = {}) {
  if (!isAbsolute(descriptor.entry) || !isAbsolute(descriptor.executable))
    throw new ValidationError("CLI launch paths must be absolute");
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
export async function runFactoryForeground(input: { maxWorkers?: number }, ctx: ServiceContext = {}) {
  const { runtime, agentDir } = await createFactoryRuntime();
  const shim = await createCliShim(
    { executable: process.execPath, execArgv: process.execArgv, entry: resolve(process.argv[1] as string) },
    ctx,
  );
  const manager = await createFactoryManager(
    {
      runtime,
      agentDir,
      shim,
      skillsDir: (await bundledSkills(ctx)).dir,
      maxWorkers: input.maxWorkers,
      onModel: (role, model) => console.error(`${role}: ${model.provider}/${model.modelId}`),
    },
    ctx,
  );
  const stop = () => {
    void manager.shutdown();
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
  try {
    await manager.run();
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
    await manager.shutdown();
    await runtime.settleCredentialWrites();
  }
  return { phase: "stopped" };
}
