import type { PolicyState } from "../factory-policy/factory-policy.js";
import type { ServiceContext } from "../workspace/workspace.js";
import { readState, withStateLock, writeState } from "./state-file.js";

export { withStateLock } from "./state-file.js";

/** Reads the v1 policy state of the Project without the state lock. */
export async function readFactoryState(root: string, _ctx: ServiceContext = {}): Promise<PolicyState> {
  return readState(root);
}

/** Runs only a short state transaction. Do not call Git, models or projectWrite inside this callback. */
export async function updateFactoryState(
  root: string,
  update: (state: PolicyState) => PolicyState | Promise<PolicyState>,
  _ctx: ServiceContext = {},
): Promise<PolicyState> {
  return withStateLock(root, async () => writeState(root, await update(await readState(root))));
}
