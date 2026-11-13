import { loadPi } from "./pi-runtime.js";

/** Uses Pi's normal credential store and defaults without a host authentication flow. */
export async function createFactoryRuntime() {
  const sdk = await loadPi();

  return {
    runtime: await sdk.ModelRuntime.create({ refreshOnCreate: false, allowModelNetwork: false }),
    agentDir: sdk.getAgentDir(),
  };
}
