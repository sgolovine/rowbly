import { execFile } from "node:child_process";
import { readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { attachmentDir } from "../attachment-files/attachment-files.js";
import { createStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { addAttachment, openAttachment, removeAttachment } from "./attachment.js";

vi.mock("node:child_process", async (original) => ({ ...(await original<object>()), execFile: vi.fn() }));
describe("openAttachment", () => {
  const p = useTestProject();
  it("uses the associated platform application and reports a failed opener", async () => {
    const story = await createStory({ title: "Image" }, p.ctx);
    const a = await addAttachment(
      { story: story.id, image: { name: "image.png", bytes: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]) } },
      p.ctx,
    );
    const exec = vi.mocked(execFile);
    exec.mockImplementation(((
      _file: unknown,
      _args: unknown,
      _opts: unknown,
      callback: (err: Error | null, stdout: string, stderr: string) => void,
    ) => {
      callback(null, "", "");
    }) as typeof execFile);
    expect(await openAttachment({ story: story.id, id: a?.id as string }, p.ctx)).toEqual({ opened: a?.id });
    const expected = process.platform === "darwin" ? "open" : process.platform === "win32" ? "rundll32" : "xdg-open";
    expect(exec.mock.calls[0]?.[0]).toBe(expected);
    exec.mockImplementation(((
      _file: unknown,
      _args: unknown,
      _opts: unknown,
      callback: (err: Error | null) => void,
    ) => {
      callback(new Error("no application"));
    }) as typeof execFile);
    await expect(openAttachment({ story: story.id, id: a?.id as string }, p.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Cannot open attachment",
    });
  });

  it("opens and removes a file that is not a PNG", async () => {
    const story = await createStory({ title: "Files" }, p.ctx);
    const dir = await attachmentDir(p.paths, story.id);
    await writeFile(join(p.paths.root, "report.pdf"), "%PDF-1.7\n");
    const added = await addAttachment({ story: story.id, file: "report.pdf" }, { ...p.ctx, cwd: p.paths.root });
    const exec = vi.mocked(execFile);

    exec.mockImplementation(((_file: unknown, _args: unknown, _opts: unknown, callback: (err: null) => void) => {
      callback(null);
    }) as typeof execFile);

    expect(await openAttachment({ story: story.id, id: added.id }, p.ctx)).toEqual({ opened: added.id });
    expect(exec.mock.calls.at(-1)?.[1]).toContain(join(dir, `${added.id}.pdf`));
    expect(await removeAttachment({ story: story.id, id: added.id }, p.ctx)).toEqual({ removed: added.id });
    expect(await readdir(dir)).toEqual(["manifest.json"]);
  });
});
