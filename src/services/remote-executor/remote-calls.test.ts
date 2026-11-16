import { describe, expect, it } from "vitest";
import type { RemoteCommand } from "../host-transport/host-transport.js";
import { createFakeHostTransport } from "../test-project/fake-host-transport.js";
import { cacheMissing, cachePut, runPaths, serve, submit } from "./remote-calls.js";

const ROWBLY = "/opt/rowbly/bin/rowbly";

describe("remote calls", () => {
  it("runs the fixed host commands with the project id", async () => {
    const calls: [RemoteCommand, unknown][] = [];
    const transport = createFakeHostTransport({
      request: (command, input) => {
        calls.push([command, input]);
        const name = command[2];
        if (name === "cache-missing") return { exitCode: 0, value: { missing: ["a1"] }, stderr: "" };
        if (name === "run-paths")
          return { exitCode: 0, value: { copy: "/c", worktree: "/w", shim: "/s", lock: "/l" }, stderr: "" };
        return { exitCode: 0, value: null, stderr: "" };
      },
    });
    const target = { connection: { transport, rowbly: ROWBLY, clone: "repo" }, projectId: "p1" };

    expect(await cacheMissing(target, [])).toEqual([]);
    expect(await cacheMissing(target, ["a1", "a2"])).toEqual(["a1"]);
    await cachePut(target, "a1", Buffer.from("x"));
    expect(await runPaths(target, "t1", "ROW-1")).toMatchObject({ copy: "/c" });
    await serve(target, 3);
    expect(await submit(target, "stop-thread", "t1", "c1")).toBeNull();

    expect(calls).toEqual([
      [[ROWBLY, "host", "cache-missing", "p1"], { ids: ["a1", "a2"] }],
      [[ROWBLY, "host", "run-paths", "p1"], { threadId: "t1", storyId: "ROW-1", clone: "repo" }],
      [[ROWBLY, "host", "serve", "--detach"], { projectId: "p1", maxWorkers: 3 }],
      [[ROWBLY, "host", "submit", "p1"], { version: 1, id: "c1", type: "stop-thread", threadId: "t1" }],
    ]);
    expect(transport.uploads.map((upload) => upload.command)).toEqual([[ROWBLY, "host", "cache-put", "p1", "a1"]]);
  });

  it("gives a HOST_PROTOCOL error for a remote failure or a bad answer", async () => {
    const transport = createFakeHostTransport({
      request: (command) =>
        command[2] === "run-paths"
          ? { exitCode: 0, value: {}, stderr: "" }
          : { exitCode: 1, value: undefined, stderr: "Thread t1 has active work\n" },
      upload: () => ({ exitCode: 1, stderr: "too large" }),
    });
    const target = { connection: { transport, rowbly: ROWBLY, clone: "repo" }, projectId: "p1" };

    await expect(submit(target, "launch", "t1")).rejects.toMatchObject({
      code: "HOST_PROTOCOL",
      message: expect.stringContaining("Thread t1 has active work"),
    });
    await expect(runPaths(target, "t1", "ROW-1")).rejects.toMatchObject({ code: "HOST_PROTOCOL" });
    await expect(cachePut(target, "a1", Buffer.from("x"))).rejects.toMatchObject({ code: "HOST_PROTOCOL" });
  });
});
