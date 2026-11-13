import { join } from "node:path";
import { pathToFileURL } from "node:url";
import type { PolicyState } from "../factoryPolicy/factoryPolicy.js";
import { bundledSkills } from "../skill/skill.js";
import type { ServiceContext } from "../workspace/workspace.js";

type StateModule = typeof import("../../../skills/factory/scripts/factory-state.mjs");

/** Loads the shipped script by URL so its executable entry stays outside the CLI bundle. */
export async function loadFactoryState(ctx: ServiceContext = {}): Promise<StateModule> {
  const { dir } = await bundledSkills(ctx);
  return import(pathToFileURL(join(dir, "factory", "scripts", "factory-state.mjs")).href);
}

export async function readFactoryState(root: string, ctx: ServiceContext = {}): Promise<PolicyState> {
  return (await loadFactoryState(ctx)).readState(root);
}

/** Runs only a short state transaction. Do not call Git, models or projectWrite inside this callback. */
export async function updateFactoryState(
  root: string,
  update: (state: PolicyState) => PolicyState | Promise<PolicyState>,
  ctx: ServiceContext = {},
): Promise<PolicyState> {
  const module = await loadFactoryState(ctx);
  return module.withStateLock(root, async () => module.writeState(root, await update(await module.readState(root))));
}
