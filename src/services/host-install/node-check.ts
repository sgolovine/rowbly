import type { HostTransport } from "../host-transport/host-transport.js";
import { HostNodeMissingError, HostNodeTooOldError } from "./host-install-errors.js";

/** The oldest Node version that Rowbly supports, as major, minor and patch. */
export const MIN_NODE_VERSION: NodeVersion = [22, 19, 0];

/** The output limit of `node --version`. The output is one short line. */
const VERSION_OUTPUT_LIMIT = 4096;

/** A Node version as major, minor and patch. */
export type NodeVersion = readonly [number, number, number];

/** Reads the output of `node --version`, for example `v22.19.0`. It gives `undefined` for other text. */
export function parseNodeVersion(text: string): NodeVersion | undefined {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/.exec(text.trim());

  if (!match) {
    return undefined;
  }

  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

/** Compares two versions. It gives a negative number, 0 or a positive number. */
export function compareNodeVersions(left: NodeVersion, right: NodeVersion): number {
  const index = left.findIndex((part, position) => part !== right[position]);

  return index === -1 ? 0 : left[index] - right[index];
}

/** Tells if Rowbly can run on this Node version. */
export function isSupportedNode(version: NodeVersion): boolean {
  return compareNodeVersions(version, MIN_NODE_VERSION) >= 0;
}

function minimumText(): string {
  return `v${MIN_NODE_VERSION.join(".")}`;
}

function nodeMissing(exitCode: number, output: string, stderr: string): HostNodeMissingError {
  return new HostNodeMissingError("The worker host has no Node on the PATH of a non-interactive SSH session.", {
    details: { exitCode, output: output.slice(0, 200), stderr: stderr.trim().slice(0, 500) },
    hint: `Install Node ${minimumText()} or later on the host, and put it on the PATH of a non-interactive SSH session. A Node that only .bashrc loads, for example from nvm, is not sufficient.`,
  });
}

function nodeTooOld(found: string): HostNodeTooOldError {
  return new HostNodeTooOldError(`The worker host has Node ${found}. Rowbly needs ${minimumText()} or later.`, {
    details: { found, minimum: minimumText() },
    hint: `Install Node ${minimumText()} or later on the host.`,
  });
}

/** Runs `node --version` on the host and gives the version text. It throws when Node is missing or too old. */
export async function checkHostNode(transport: HostTransport): Promise<string> {
  const result = await transport.bytes(["node", "--version"], null, { limit: VERSION_OUTPUT_LIMIT });
  const output = result.bytes.toString("utf8").trim();
  const version = parseNodeVersion(output);

  // A shell gives exit code 127 when it cannot find `node`. Any failure or empty output means that no Node can run.
  if (result.exitCode !== 0 || output === "" || !version) {
    throw nodeMissing(result.exitCode, output, result.stderr);
  }

  if (!isSupportedNode(version)) {
    throw nodeTooOld(output);
  }

  return output;
}
