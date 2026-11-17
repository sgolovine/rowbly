import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { processCommands } from "../../services/factory-control/factory-control.js";
import { acquireFactoryOwnership, newOwner } from "../../services/factory-ownership/factory-ownership.js";
import { prepareRuntime } from "../../services/runtime-files/runtime-files.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { createThread, transitionThread } from "../../services/thread/thread.js";
import { runCli } from "../test-cli/test-cli.js";

vi.mock("@earendil-works/pi-coding-agent", () => {
  throw new Error("SDK must stay unloaded");
});
describe("thread", () => {
  const p = useTestProject();
  it("lists and shows thread metadata with Pi import blocked", async () => {
    const t = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "test" },
      p.ctx,
    );
    const list = await runCli(["thread", "list", "--story", "ROW-1", "--json"], p.paths.root);
    expect(list.exitCode).toBe(0);
    expect(JSON.parse(list.stdout).threads[0].id).toBe(t.id);
    expect((await runCli(["thread", "show", t.id], p.paths.root)).stdout).toContain("pending");
  });
  it("shows the host of each Thread, also of an old Thread file without a host", async () => {
    const worker = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "test" },
      p.ctx,
    );
    const old = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);
    const list = await runCli(["thread", "list", "--json"], p.paths.root);
    expect(JSON.parse(list.stdout).threads.map((t: { host: string }) => t.host)).toEqual(["local", "local"]);
    const shown = await runCli(["thread", "show", old.id, "--json"], p.paths.root);
    expect(JSON.parse(shown.stdout).host).toBe("local");
    const text = await runCli(["thread", "list"], p.paths.root);
    expect(text.stdout).toContain(`${worker.id}  ROW-1 DEVELOP pending  unresolved  local`);
  });
  it("prints a bounded active-branch tail and rejects excessive limits", async () => {
    const t = await createThread({ role: "supervisor", cwd: p.paths.root, ownerToken: "test" }, p.ctx);
    const file = `sessions/${t.id}/fixture.jsonl`;
    await mkdir(join(p.paths.runtimeDir, `sessions/${t.id}`), { recursive: true });
    await writeFile(
      join(p.paths.runtimeDir, file),
      await readFile(new URL("../../services/conversation/fixtures/branch.jsonl", import.meta.url)),
    );
    await transitionThread(
      t.id,
      { expectedRevision: 1, status: "completed", patch: { session: { id: t.id, file } } },
      p.ctx,
    );
    const result = await runCli(["thread", "log", t.id, "--tail", "2", "--json"], p.paths.root);
    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.stdout).entries.map((e: { id: string }) => e.id)).toEqual(["c", "d"]);
    const excessive = await runCli(["thread", "log", t.id, "--tail", "101"], p.paths.root);
    expect(excessive.exitCode).toBe(1);
    expect(excessive.stderr).toContain("bounds");
  });
  it("steers through the CLI: a missing --message is a Commander error, an empty message is VALIDATION", async () => {
    const missing = await runCli(["thread", "steer", "thread-1", "--json"], p.paths.root);
    expect(missing.exitCode).not.toBe(0);
    expect(missing.stderr).toContain("--message");
    const empty = await runCli(["thread", "steer", "thread-1", "--message", "  ", "--json"], p.paths.root);
    expect(empty.exitCode).toBe(1);
    expect(JSON.parse(empty.stderr || empty.stdout).error.code).toBe("VALIDATION");
    const stopped = await runCli(["thread", "steer", "thread-1", "--message", "Stop", "--json"], p.paths.root);
    expect(stopped.exitCode).not.toBe(0);
    expect(stopped.stderr + stopped.stdout).toContain("Factory is not running");
  });
  it("steers a Thread through the live daemon and prints the receipt", async () => {
    await prepareRuntime(p.paths);
    const owner = await newOwner();
    await acquireFactoryOwnership(p.paths, owner);
    const t = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: owner.token },
      p.ctx,
    );
    const execute = vi.fn(async () => {});
    const result = runCli(["thread", "steer", t.id, "--message", "Use the new API", "--json"], p.paths.root);
    await vi.waitFor(async () => {
      await processCommands(p.paths, owner.token, execute);
      expect(execute).toHaveBeenCalledWith(expect.objectContaining({ type: "steer", message: "Use the new API" }));
    });
    const done = await result;
    expect(done.exitCode).toBe(0);
    expect(JSON.parse(done.stdout)).toMatchObject({ status: "completed", threadId: t.id });
  });
  it("lists, applies and discards the held entries of an abandoned remote Thread without a factory", async () => {
    const t = await createThread(
      { role: "worker", storyId: "ROW-1", stage: "DEVELOP", cwd: p.paths.root, ownerToken: "test", host: "mini" },
      p.ctx,
    );
    const abandoned = { at: "2026-11-16T10:00:00.000Z", reason: "cancel" as const, appliedSeq: 0 };
    await transitionThread(t.id, { expectedRevision: 1, status: "cancelled", patch: { abandoned } }, p.ctx);
    const held = join(p.paths.runtimeDir, "hosts", "mini", "held", t.id);
    await mkdir(held, { recursive: true });
    const entry = {
      seq: 5,
      opId: "op",
      threadId: t.id,
      storyId: "ROW-1",
      changes: [{ path: "title", before: "Missing", after: "X" }],
    };
    await writeFile(join(held, "entries.jsonl"), `${JSON.stringify(entry)}\n`);

    const list = await runCli(["thread", "held", t.id], p.paths.root);
    expect(list.exitCode).toBe(0);
    expect(list.stdout).toContain("5  ROW-1  title");
    const json = await runCli(["thread", "held", t.id, "--json"], p.paths.root);
    expect(JSON.parse(json.stdout)).toMatchObject({ action: "list", host: "mini", entries: [{ seq: 5 }] });

    const both = await runCli(["thread", "held", t.id, "--apply", "--discard", "--json"], p.paths.root);
    expect(both.exitCode).not.toBe(0);
    expect(both.stdout + both.stderr).toContain("VALIDATION");

    const applied = await runCli(["thread", "held", t.id, "--apply", "--json"], p.paths.root);
    expect(applied.exitCode).toBe(0);
    expect(JSON.parse(applied.stdout)).toMatchObject({ action: "apply", applied: [], conflicts: [{ seq: 5 }] });

    const discarded = await runCli(["thread", "held", t.id, "--discard"], p.paths.root);
    expect(discarded.stdout).toContain("Discarded 1 held entries");
    expect((await runCli(["thread", "held", t.id], p.paths.root)).stdout).toContain("No held entries.");
  });
});
