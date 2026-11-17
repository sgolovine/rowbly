import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachmentDir } from "../attachment-files/attachment-files.js";
import { createStory, getStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { addAttachment, MAX_ATTACHMENT_BYTES, readClipboardAttachment } from "./attachment.js";

const mocks = vi.hoisted(() => ({ readClipboard: vi.fn() }));
vi.mock("../clipboard/clipboard.js", async (original) => ({
  ...(await original<object>()),
  readClipboard: mocks.readClipboard,
}));

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
describe("clipboard attachments", () => {
  const p = useTestProject();
  const now = () => new Date("2026-11-10T18:23:00Z");
  beforeEach(() => mocks.readClipboard.mockReset());
  async function setup() {
    const story = await createStory({ title: "Clipboard" }, p.ctx);
    return { story, dir: await attachmentDir(p.paths, story.id) };
  }
  it("attaches a copied file with its name, type and bytes", async () => {
    const { story, dir } = await setup();
    const file = join(p.paths.root, "copied", "notes.txt");
    await mkdir(join(p.paths.root, "copied"));
    await writeFile(file, "some notes\n");
    mocks.readClipboard.mockResolvedValue({ kind: "file", path: file });
    const record = await addAttachment({ story: story.id, fromClipboard: true }, { ...p.ctx, now });
    expect(record).toMatchObject({ name: "notes.txt", type: "text/plain", size: 11 });
    expect(await readFile(join(dir, `${record.id}.txt`), "utf8")).toBe("some notes\n");
  });
  it("rejects a large file, a folder and a missing path without a change to the Story", async () => {
    const { story, dir } = await setup();
    const before = await getStory({ id: story.id }, p.ctx);
    const big = join(p.paths.root, "big.bin");
    await writeFile(big, Buffer.alloc(MAX_ATTACHMENT_BYTES + 1));
    const cases = [
      [big, { code: "VALIDATION", message: "Attachment exceeds 10 MiB" }],
      [p.paths.root, { code: "VALIDATION", message: "The clipboard file is not a regular file" }],
      [join(p.paths.root, "missing.txt"), { code: "NOT_FOUND" }],
    ] as const;
    for (const [path, error] of cases) {
      mocks.readClipboard.mockResolvedValue({ kind: "file", path });
      await expect(addAttachment({ story: story.id, fromClipboard: true }, p.ctx)).rejects.toMatchObject(error);
    }
    expect(await readdir(dir).catch(() => [])).toEqual([]);
    expect((await getStory({ id: story.id }, p.ctx)).updatedAt).toBe(before.updatedAt);
  });
  it.each([
    ["image/png", png, "image-20261110-1823.png"],
    ["image/jpeg", Buffer.from([255, 216, 255]), "image-20261110-1823.jpg"],
    ["image/gif", Buffer.from("GIF89a"), "image-20261110-1823.gif"],
    ["image/webp", Buffer.from("RIFF"), "image-20261110-1823.webp"],
  ])("attaches a %s image with a name from the time", async (type, bytes, name) => {
    const { story, dir } = await setup();
    mocks.readClipboard.mockResolvedValue({ kind: "image", bytes, type });
    const record = await addAttachment({ story: story.id, fromClipboard: true }, { ...p.ctx, now });
    expect(record).toMatchObject({ name, type, size: bytes.length });
    expect(await readFile(join(dir, `${record.id}${name.slice(name.lastIndexOf("."))}`))).toEqual(bytes);
  });
  it("gives the clipboard failure with its reason and hint", async () => {
    mocks.readClipboard.mockResolvedValue({ reason: "multiple-files" });
    await expect(readClipboardAttachment(p.ctx, "ROW-01")).rejects.toMatchObject({
      code: "VALIDATION",
      message: "The clipboard has more than one file; copy one file",
      details: { reason: "multiple-files" },
    });
    mocks.readClipboard.mockResolvedValue({ reason: "no-image" });
    await expect(readClipboardAttachment(p.ctx, "ROW-01")).rejects.toMatchObject({
      message: "No file or image on the clipboard",
      hint: expect.stringContaining("rowbly add-attachment ROW-01 <file>"),
    });
  });
});
