import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { useTempDir } from "../test-project/test-project.js";
import {
  HOST_COMMAND_LIMIT,
  type HostCommand,
  pendingCommandCount,
  processHostCommands,
  readHostReceipt,
  submitHostCommand,
} from "./host-agent-control.js";
import { hostAgentPaths, prepareAgentDirs } from "./host-agent-paths.js";

const stop = (id: string) => JSON.stringify({ version: 1, id, type: "stop" });

describe("host agent commands", () => {
  const home = useTempDir();
  const paths = () => hostAgentPaths("p1", home.path);

  it("writes the command durably with mode 0600 and gives null before the agent runs it", async () => {
    expect(await submitHostCommand(paths(), stop("r1"))).toBeNull();
    const file = join(paths().control, "r1.json");
    expect(JSON.parse(await readFile(file, "utf8"))).toEqual({ version: 1, id: "r1", type: "stop" });
    expect((await stat(file)).mode & 0o777).toBe(0o600);
    expect(await pendingCommandCount(paths())).toBe(1);
  });

  it("refuses a command without a valid id, bad JSON or a too large text, and writes no file", async () => {
    for (const text of [
      "{",
      "[]",
      JSON.stringify({ version: 1, type: "stop" }),
      JSON.stringify({ version: 1, id: "a/b", type: "stop" }),
      JSON.stringify({ version: 1, id: "x".repeat(129), type: "stop" }),
      JSON.stringify({ version: 1, id: "big", type: "stop", pad: "x".repeat(HOST_COMMAND_LIMIT) }),
    ]) {
      await expect(submitHostCommand(paths(), text)).rejects.toMatchObject({ code: "VALIDATION" });
    }
    expect(await pendingCommandCount(paths())).toBe(0);
  });

  it("runs a stop command one time and writes accepted, then completed", async () => {
    await submitHostCommand(paths(), stop("r1"));
    const seen: (string | undefined)[] = [];
    const execute = vi.fn(async (command: HostCommand) => {
      seen.push((await readHostReceipt(paths(), command.id))?.status);
    });

    await processHostCommands(paths(), "token-1", execute);
    await processHostCommands(paths(), "token-2", execute);

    expect(execute).toHaveBeenCalledTimes(1);
    expect(seen).toEqual(["accepted"]);
    expect(await readHostReceipt(paths(), "r1")).toEqual({
      version: 1,
      id: "r1",
      ownerToken: "token-1",
      status: "completed",
    });
    expect((await stat(join(paths().receipts, "r1.json"))).mode & 0o777).toBe(0o600);
    expect(await pendingCommandCount(paths())).toBe(0);
  });

  it("keeps the file of a duplicate command and gives the existing receipt", async () => {
    await submitHostCommand(paths(), stop("r1"));
    await processHostCommands(paths(), "token-1", async () => undefined);
    const before = await readFile(join(paths().control, "r1.json"), "utf8");

    const receipt = await submitHostCommand(paths(), JSON.stringify({ version: 1, id: "r1", type: "launch" }));

    expect(receipt).toMatchObject({ id: "r1", status: "completed" });
    expect(await readFile(join(paths().control, "r1.json"), "utf8")).toBe(before);
  });

  it("rejects a bad command with a receipt", async () => {
    await prepareAgentDirs(paths());
    const files: Record<string, string> = {
      "bad-json": "{",
      "bad-type": JSON.stringify({ version: 1, id: "bad-type", type: "explode" }),
      "bad-id": JSON.stringify({ version: 1, id: "other", type: "stop" }),
      "bad-version": JSON.stringify({ version: 2, id: "bad-version", type: "stop" }),
      "bad-launch": JSON.stringify({ version: 1, id: "bad-launch", type: "launch", threadId: "a/b" }),
      "bad-payload": JSON.stringify({ version: 1, id: "bad-payload", type: "launch", threadId: "t1", payload: [] }),
      "bad-resume": JSON.stringify({ version: 1, id: "bad-resume", type: "resume" }),
      "bad-stop-thread": JSON.stringify({ version: 1, id: "bad-stop-thread", type: "stop-thread", threadId: "" }),
      "bad-cancel-thread": JSON.stringify({ version: 1, id: "bad-cancel-thread", type: "cancel-thread" }),
      "too-large": JSON.stringify({ version: 1, id: "too-large", type: "stop", pad: "x".repeat(HOST_COMMAND_LIMIT) }),
    };
    for (const [id, text] of Object.entries(files)) await writeFile(join(paths().control, `${id}.json`), text);
    const execute = vi.fn(async () => undefined);

    await processHostCommands(paths(), "token-1", execute);

    expect(execute).not.toHaveBeenCalled();
    for (const id of Object.keys(files)) {
      expect(await readHostReceipt(paths(), id)).toMatchObject({ id, status: "rejected", ownerToken: "token-1" });
    }
    expect((await readHostReceipt(paths(), "too-large"))?.error?.message).toBe("Command is too large");
  });

  it("gives the error code of a Rowbly error in the rejected receipt", async () => {
    await submitHostCommand(paths(), JSON.stringify({ version: 1, id: "r1", type: "launch", threadId: "t1" }));
    const { HostNoFreeSlotError } = await import("../host-transport/host-errors.js");

    await processHostCommands(paths(), "token-1", async () => {
      throw new HostNoFreeSlotError("No slot");
    });

    expect(await readHostReceipt(paths(), "r1")).toEqual({
      version: 1,
      id: "r1",
      ownerToken: "token-1",
      status: "rejected",
      threadId: "t1",
      error: { code: "HOST_NO_FREE_SLOT", message: "No slot" },
    });
  });

  it("keeps a corrupt receipt and does not run its command", async () => {
    await submitHostCommand(paths(), stop("r1"));
    const receipt = join(paths().receipts, "r1.json");
    await writeFile(receipt, "not json");
    const execute = vi.fn(async () => undefined);

    await processHostCommands(paths(), "token-1", execute);

    expect(execute).not.toHaveBeenCalled();
    expect(await readFile(receipt, "utf8")).toBe("not json");
    expect(await pendingCommandCount(paths())).toBe(0);
    await expect(readHostReceipt(paths(), "r1")).rejects.toThrow();
  });

  it("runs a command again when only its accepted receipt exists", async () => {
    await submitHostCommand(paths(), stop("r1"));
    await writeFile(
      join(paths().receipts, "r1.json"),
      JSON.stringify({ version: 1, id: "r1", ownerToken: "old", status: "accepted" }),
    );
    const execute = vi.fn(async () => undefined);

    await processHostCommands(paths(), "token-1", execute);

    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("accepts the Thread commands with a valid threadId", async () => {
    for (const type of ["launch", "resume", "stop-thread", "cancel-thread"]) {
      await submitHostCommand(paths(), JSON.stringify({ version: 1, id: `c-${type}`, type, threadId: "t1" }));
    }
    const types: string[] = [];

    await processHostCommands(paths(), "token-1", async (command) => void types.push(command.type));

    expect(types.toSorted()).toEqual(["cancel-thread", "launch", "resume", "stop-thread"]);
  });
});
