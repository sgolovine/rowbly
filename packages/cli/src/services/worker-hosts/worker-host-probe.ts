// The check of one worker host for the factory: the Rowbly version, then the short check of the main machine.

import type { WorkerHostView } from "../factory-manager/host-slots.js";
import { quickHostCheck } from "../host-check/host-check.js";
import { ensureHostVersion } from "../host-install/host-install.js";
import type { LocalBuild } from "../host-install/local-build.js";
import type { HostTransport } from "../host-transport/host-transport.js";

/** The state and the providers of a host after one check. */
export type ProbedHost = Pick<WorkerHostView, "state" | "providers">;

/** The connection and the build of one check. Each one can throw. */
export interface ProbeInput {
  readonly transport: () => HostTransport;
  readonly build: () => Promise<LocalBuild>;
}

async function probe(input: ProbeInput): Promise<ProbedHost> {
  const transport = input.transport();
  const build = await input.build();
  const install = await ensureHostVersion(transport, { build });

  if (install.state === "version-mismatch") {
    return { state: "version-mismatch" };
  }

  const quick = await quickHostCheck(transport, build);

  return quick.ready ? { state: "connected", providers: quick.providers } : { state: "not-ready" };
}

/**
 * Installs the exact Rowbly build on the host when the version is different, then runs the short check. It never
 * throws: a transport failure or any other error gives `disconnected`.
 */
export async function probeWorkerHost(input: ProbeInput): Promise<ProbedHost> {
  try {
    return await probe(input);
  } catch {
    return { state: "disconnected" };
  }
}
