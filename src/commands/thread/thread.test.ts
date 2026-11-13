import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
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
});
