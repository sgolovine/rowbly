import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createStory } from "../../services/story/story.js";
import { useTestProject } from "../../services/test-project/test-project.js";
import { runCli } from "../test-cli/test-cli.js";

vi.mock("../../services/clipboard/clipboard.js", async (original) => ({
  ...(await original<object>()),
  readClipboardImage: vi.fn(async () => ({ reason: "no-image" })),
}));
describe("attachment commands", () => {
  const p = useTestProject();
  it("adds, lists, and removes ordered JSON records through -C", async () => {
    await createStory({ title: "Test" }, p.ctx);
    const file = join(p.paths.root, "image.png");
    await writeFile(file, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const added = await runCli(["--json", "add-attachment", "ROW-01", file], p.paths.root);
    expect(added.exitCode).toBe(0);
    const record = JSON.parse(added.stdout);
    expect(record.name).toBe("image.png");
    const list = await runCli(["--json", "list-attachments", "ROW-01"], p.paths.root);
    expect(JSON.parse(list.stdout)).toEqual([record]);
    const remove = await runCli(["--json", "remove-attachment", "ROW-01", record.id], p.paths.root);
    expect(JSON.parse(remove.stdout)).toEqual({ removed: record.id });
    const unknown = await runCli(["--json", "open-attachment", "ROW-01", record.id], p.paths.root);
    expect(JSON.parse(unknown.stderr).error.code).toBe("NOT_FOUND");
  });
  it("reports source errors, missing Stories, and clipboard reasons as typed JSON", async () => {
    await createStory({ title: "Test" }, p.ctx);
    for (const args of [
      ["add-attachment", "1"],
      ["add-attachment", "1", "x", "--from-clipboard"],
    ]) {
      const result = await runCli(["--json", ...args], p.paths.root);
      expect(JSON.parse(result.stderr).error.code).toBe("VALIDATION");
    }
    const result = await runCli(["--json", "add-attachment", "1", "--from-clipboard"], p.paths.root);
    expect(JSON.parse(result.stderr).error.details.reason).toBe("no-image");
    expect((await runCli(["--json", "list-attachments", "999"], p.paths.root)).exitCode).toBe(1);
  });
});
