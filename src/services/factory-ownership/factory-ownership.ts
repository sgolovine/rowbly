import {
  acquireOwner,
  newOwner,
  type Owner,
  type OwnerProbe,
  probeOwner,
  readOwner,
  releaseOwner,
} from "../../../skills/factory/scripts/ownership-lock.mjs";
import { ConflictError } from "../errors/errors.js";
import { prepareRuntime, runtimePath } from "../runtime-files/runtime-files.js";
import { type ProjectPaths, runtimePaths } from "../workspace/workspace.js";

export type { Owner, OwnerProbe };
export { newOwner, probeOwner };

/** Takes daemon ownership of the Project. A live, foreign or uncertain owner gives a ConflictError. */
export async function acquireFactoryOwnership(paths: ProjectPaths, owner: Owner, probe: OwnerProbe = probeOwner) {
  await prepareRuntime(paths);
  await runtimePath(paths, "factory.lock");
  await runtimePath(paths, "lifecycle.guard");

  const runtime = runtimePaths(paths);

  try {
    return await acquireOwner(runtime.lockFile, runtime.guardFile, owner, probe);
  } catch (cause) {
    throw new ConflictError("Factory ownership is unavailable", {
      cause,
      hint: `Stop all factory processes before offline repair. ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
}

/** Throws a ConflictError when the lock file no longer holds the owner token. */
export async function assertFactoryOwnership(paths: ProjectPaths, token: string): Promise<void> {
  const path = await runtimePath(paths, "factory.lock");

  if ((await readOwner(path))?.token !== token) {
    throw new ConflictError("Factory owner token changed");
  }
}

/** Releases daemon ownership when the lock file still holds the owner token. */
export async function releaseFactoryOwnership(paths: ProjectPaths, token: string): Promise<boolean> {
  await runtimePath(paths, "factory.lock");
  await runtimePath(paths, "lifecycle.guard");

  const runtime = runtimePaths(paths);

  return releaseOwner(runtime.lockFile, runtime.guardFile, token);
}

/** Reads the current daemon owner of the Project, if there is one. */
export async function readFactoryOwner(paths: ProjectPaths) {
  return readOwner(await runtimePath(paths, "factory.lock"));
}
