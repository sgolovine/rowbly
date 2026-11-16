import { describe, expect, it } from "vitest";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { checkHostNode, compareNodeVersions, isSupportedNode, parseNodeVersion } from "./node-check.js";

function nodeHost(exitCode: number, output: string, stderr = "") {
  return createFakeHostTransport({
    bytes: (command) => {
      expect(command).toEqual(["node", "--version"]);
      return { exitCode, bytes: Buffer.from(output), stderr };
    },
  });
}

describe("node check", () => {
  it("parses node --version output", () => {
    expect(parseNodeVersion("v22.19.0\n")).toEqual([22, 19, 0]);
    expect(parseNodeVersion("24.1.0")).toEqual([24, 1, 0]);
    expect(parseNodeVersion("bash: node: command not found")).toBeUndefined();
    expect(parseNodeVersion("")).toBeUndefined();
  });

  it("compares versions", () => {
    expect(compareNodeVersions([22, 19, 0], [22, 19, 0])).toBe(0);
    expect(compareNodeVersions([22, 18, 9], [22, 19, 0])).toBeLessThan(0);
    expect(compareNodeVersions([23, 0, 0], [22, 19, 0])).toBeGreaterThan(0);
    expect(isSupportedNode([22, 19, 0])).toBe(true);
    expect(isSupportedNode([22, 18, 0])).toBe(false);
  });

  it.each(["v22.19.0", "v24.1.0"])("accepts %s", async (version) => {
    await expect(checkHostNode(nodeHost(0, `${version}\n`))).resolves.toBe(version);
  });

  it.each(["v22.18.0", "v20.11.1"])("refuses %s with HOST_NODE_TOO_OLD and the found version", async (version) => {
    const error = await checkHostNode(nodeHost(0, `${version}\n`)).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "HOST_NODE_TOO_OLD", details: { found: version, minimum: "v22.19.0" } });
    expect((error as { hint?: string }).hint).toContain("22.19.0");
  });

  it.each([
    ["exit code 127", 127, "", "sh: 1: node: not found"],
    ["no output", 0, "", ""],
    ["output that is not a version", 0, "hello", ""],
  ])("refuses %s with HOST_NODE_MISSING", async (_name, exitCode, output, stderr) => {
    const error = await checkHostNode(nodeHost(exitCode, output, stderr)).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ code: "HOST_NODE_MISSING" });
    expect((error as { hint?: string }).hint).toContain("non-interactive SSH session");
  });
});
