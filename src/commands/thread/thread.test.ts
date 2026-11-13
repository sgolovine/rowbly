import { describe, expect, it, vi } from "vitest";
import { useTestProject } from "../../services/testProject/testProject.js";
import { createThread } from "../../services/thread/thread.js";
import { runCli } from "../testCli/testCli.js";

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
});
