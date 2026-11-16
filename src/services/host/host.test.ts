import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { recordProject } from "../known-project/known-project.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread, transitionThread } from "../thread/thread.js";
import type { ThreadStatus } from "../thread/thread-types.js";
import { RC_FILE } from "../user-rc/user-rc.js";
import { addHost, listHosts, removeHost } from "./host.js";

describe("host", () => {
  const p = useTestProject();
  const rcFile = () => join(p.ctx.home as string, RC_FILE);
  const stored = async () => JSON.parse(await readFile(rcFile(), "utf8"));
  const mini = { id: "mini", ssh: "user@mini.lan", maxWorkers: 2 };

  const errorCode = (promise: Promise<unknown>) =>
    promise.then(
      () => "OK",
      (error: { code?: string }) => error.code,
    );

  it("adds a host to the hosts array of the file and gives it back", async () => {
    const host = await addHost(mini, p.ctx);

    expect(host).toEqual({ id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true });
    expect((await stored()).hosts).toEqual([{ id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true }]);
  });

  it("lists the hosts in the order of the file, and an empty list without the key", async () => {
    expect(await listHosts(p.ctx)).toEqual([]);

    await addHost({ id: "zeta", ssh: "z", maxWorkers: 1 }, p.ctx);
    await addHost({ id: "alpha", ssh: "a", maxWorkers: 3 }, p.ctx);

    expect((await listHosts(p.ctx)).map((host) => host.id)).toEqual(["zeta", "alpha"]);
  });

  it("keeps the other keys of the file and the other keys of an entry", async () => {
    await writeFile(
      rcFile(),
      JSON.stringify({
        deviceId: "device",
        projects: [{ path: "/a", name: "A" }],
        hosts: [{ id: "old", ssh: "o", maxWorkers: 1, enabled: false, later: "kept" }],
      }),
    );

    await addHost(mini, p.ctx);

    expect(await stored()).toEqual({
      deviceId: "device",
      projects: [{ path: "/a", name: "A" }],
      hosts: [
        { id: "old", ssh: "o", maxWorkers: 1, enabled: false, later: "kept" },
        { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true },
      ],
    });
    expect(await listHosts(p.ctx)).toEqual([
      { id: "old", ssh: "o", maxWorkers: 1, enabled: false },
      { id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true },
    ]);

    await removeHost({ id: "old" }, p.ctx);

    expect(await stored()).toEqual({
      deviceId: "device",
      projects: [{ path: "/a", name: "A" }],
      hosts: [{ id: "mini", ssh: "user@mini.lan", maxWorkers: 2, enabled: true }],
    });
  });

  it.each([
    ["an ID that is not dash-case", { id: "Mini", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["an ID with a double dash", { id: "a--b", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["an ID with a trailing dash", { id: "mini-", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["an empty ID", { id: "", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["the reserved ID local", { id: "local", ssh: "u@h", maxWorkers: 1 }, "id"],
    ["an empty SSH target", { id: "mini", ssh: "", maxWorkers: 1 }, "ssh"],
    ["an SSH target that starts with -", { id: "mini", ssh: "-oProxyCommand=x", maxWorkers: 1 }, "ssh"],
    ["an SSH target with a space", { id: "mini", ssh: "user@mini lan", maxWorkers: 1 }, "ssh"],
    ["an SSH target with a tab", { id: "mini", ssh: "user@mini\tlan", maxWorkers: 1 }, "ssh"],
    ["an SSH target with a newline", { id: "mini", ssh: "user@mini\n", maxWorkers: 1 }, "ssh"],
    ["an SSH target with a control character", { id: "mini", ssh: "user@mini\u0007", maxWorkers: 1 }, "ssh"],
    ["a worker limit of 0", { id: "mini", ssh: "u@h", maxWorkers: 0 }, "maxWorkers"],
    ["a negative worker limit", { id: "mini", ssh: "u@h", maxWorkers: -1 }, "maxWorkers"],
    ["a worker limit that is not an integer", { id: "mini", ssh: "u@h", maxWorkers: 1.5 }, "maxWorkers"],
    ["a worker limit that is not a number", { id: "mini", ssh: "u@h", maxWorkers: Number.NaN }, "maxWorkers"],
  ])("refuses %s with VALIDATION and writes nothing", async (_name, input, field) => {
    const error = await addHost(input, p.ctx).catch((caught: unknown) => caught);

    expect(error).toMatchObject({ code: "VALIDATION", details: { issues: [{ path: [field] }] } });
    expect(await listHosts(p.ctx)).toEqual([]);
  });

  it("gives CONFLICT for an ID that exists and NOT_FOUND for an unknown ID", async () => {
    await addHost(mini, p.ctx);

    expect(await errorCode(addHost({ ...mini, ssh: "other" }, p.ctx))).toBe("CONFLICT");
    expect(await errorCode(removeHost({ id: "nope" }, p.ctx))).toBe("NOT_FOUND");
    expect(await listHosts(p.ctx)).toEqual([{ ...mini, enabled: true }]);
  });

  it("removes a host and gives it back with purge", async () => {
    await addHost(mini, p.ctx);
    await addHost({ id: "other", ssh: "o", maxWorkers: 1 }, p.ctx);

    expect(await removeHost({ id: "mini" }, p.ctx)).toEqual({ ...mini, enabled: true, purge: false });
    expect(await removeHost({ id: "other", purge: true }, p.ctx)).toEqual({
      id: "other",
      ssh: "o",
      maxWorkers: 1,
      enabled: true,
      purge: true,
    });
    expect((await stored()).hosts).toEqual([]);
  });

  const worker = (host: string) =>
    createThread(
      { role: "worker", storyId: "ROW-01", stage: "DEV", cwd: p.paths.root, ownerToken: "owner", host },
      p.ctx,
    );

  it.each(["pending", "running"] as ThreadStatus[])(
    "refuses to remove a host with a %s Thread in a known Project",
    async (status) => {
      await addHost(mini, p.ctx);
      await recordProject({ path: p.paths.root, name: "Rowbly" }, p.ctx);
      const thread = await worker("mini");

      if (status === "running") {
        await transitionThread(thread.id, { expectedRevision: 1, status }, p.ctx);
      }

      const error = await removeHost({ id: "mini" }, p.ctx).catch((caught: unknown) => caught);

      expect(error).toMatchObject({
        code: "CONFLICT",
        details: { threads: [{ project: p.paths.root, id: thread.id }] },
      });
      expect(await listHosts(p.ctx)).toEqual([{ ...mini, enabled: true }]);
    },
  );

  it("removes a host when its Threads ended, or when the active Threads are on other hosts", async () => {
    await addHost(mini, p.ctx);
    await recordProject({ path: p.paths.root, name: "Rowbly" }, p.ctx);
    await recordProject({ path: join(p.paths.root, "gone"), name: "Gone" }, p.ctx);
    const done = await worker("mini");

    await transitionThread(done.id, { expectedRevision: 1, status: "completed" }, p.ctx);
    await worker("other");
    await worker("local");

    expect(await removeHost({ id: "mini" }, p.ctx)).toMatchObject({ id: "mini", purge: false });
  });

  it.each([
    ["invalid JSON", "{ not json"],
    ["a value that is not an object", "[]"],
    ["a hosts value that is not an array", JSON.stringify({ hosts: {} })],
    ["a host without a field", JSON.stringify({ hosts: [{ id: "mini", ssh: "u@h", maxWorkers: 1 }] })],
    [
      "a host with a field of the wrong type",
      JSON.stringify({ hosts: [{ id: "mini", ssh: "u@h", maxWorkers: "1", enabled: true }] }),
    ],
  ])("fails each command with VALIDATION for %s and keeps the bytes", async (_name, text) => {
    await writeFile(rcFile(), text);

    expect(await errorCode(listHosts(p.ctx))).toBe("VALIDATION");
    expect(await errorCode(addHost(mini, p.ctx))).toBe("VALIDATION");
    expect(await errorCode(removeHost({ id: "mini" }, p.ctx))).toBe("VALIDATION");
    expect(await readFile(rcFile(), "utf8")).toBe(text);
  });
});
