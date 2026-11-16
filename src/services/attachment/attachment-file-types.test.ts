import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attachmentDir, readAttachments } from "../attachment-files/attachment-files.js";
import { doctor } from "../doctor/doctor.js";
import { createStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { addAttachment, listAttachments, MAX_ATTACHMENT_BYTES, removeAttachment } from "./attachment.js";

const PNG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);

describe("attachments of any file type", () => {
  const p = useTestProject();

  async function setup() {
    const story = await createStory({ title: "Files" }, p.ctx);

    return { story, dir: await attachmentDir(p.paths, story.id) };
  }

  async function attachFile(story: string, name: string, bytes: Uint8Array | string) {
    await writeFile(join(p.paths.root, name), bytes);

    return addAttachment({ story, file: name }, { ...p.ctx, cwd: p.paths.root });
  }

  it("attaches a text file with its name, MIME type and size", async () => {
    const { story, dir } = await setup();
    const text = "line one\nline two\n";

    const added = await attachFile(story.id, "notes.txt", text);

    expect(added).toMatchObject({ name: "notes.txt", type: "text/plain", size: Buffer.byteLength(text) });
    expect(await readAttachments(dir)).toEqual([added]);
    expect(await readFile(join(dir, `${added.id}.txt`), "utf8")).toBe(text);
  });

  it("attaches a PDF, a JPEG, an unknown extension and a file with no extension", async () => {
    const { story, dir } = await setup();

    const pdf = await attachFile(story.id, "report.pdf", "%PDF-1.7\n");
    const jpeg = await attachFile(story.id, "photo.JPG", Buffer.from([0xff, 0xd8, 0xff, 0xe0]));
    const unknown = await attachFile(story.id, "data.xyz", "data");
    const bare = await attachFile(story.id, "Makefile", "all:\n");

    expect([pdf.type, jpeg.type, unknown.type, bare.type]).toEqual([
      "application/pdf",
      "image/jpeg",
      "application/octet-stream",
      "application/octet-stream",
    ]);
    expect((await readdir(dir)).toSorted()).toEqual(
      [`${pdf.id}.pdf`, `${jpeg.id}.jpg`, `${unknown.id}.xyz`, bare.id, "manifest.json"].toSorted(),
    );
  });

  it("attaches an empty file and refuses a file that is larger than 10 MiB", async () => {
    const { story, dir } = await setup();

    const empty = await attachFile(story.id, "empty.log", "");

    expect(empty).toMatchObject({ name: "empty.log", type: "text/plain", size: 0 });
    expect(await readFile(join(dir, `${empty.id}.log`))).toEqual(Buffer.alloc(0));
    await expect(attachFile(story.id, "big.bin", Buffer.alloc(MAX_ATTACHMENT_BYTES + 1))).rejects.toMatchObject({
      code: "VALIDATION",
      message: "Attachment exceeds 10 MiB",
    });
    expect(await listAttachments({ story: story.id }, p.ctx)).toEqual([empty]);
  });

  it("stores a file with PNG bytes as image/png at <id>.png", async () => {
    const { story, dir } = await setup();

    const added = await attachFile(story.id, "screenshot", PNG);

    expect(added.type).toBe("image/png");
    expect(await readFile(join(dir, `${added.id}.png`))).toEqual(PNG);
  });

  it("reads a manifest of an earlier version with no change", async () => {
    const { story, dir } = await setup();
    const id = "a00000000-0000-4000-8000-000000000001";
    const legacy = [
      { id, name: "old.png", type: "image/png", size: PNG.length, createdAt: "2025-01-01T00:00:00.000Z" },
    ];
    const text = `${JSON.stringify(legacy, null, 2)}\n`;

    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "manifest.json"), text);
    await writeFile(join(dir, `${id}.png`), PNG);

    expect(await listAttachments({ story: story.id }, p.ctx)).toEqual(legacy);
    expect(await readFile(join(dir, "manifest.json"), "utf8")).toBe(text);
    expect((await doctor({}, p.ctx)).issues.filter((issue) => issue.file?.includes("attachments"))).toEqual([]);
  });

  it("restores the file and the manifest when a remove fails", async () => {
    const { story, dir } = await setup();
    const added = await attachFile(story.id, "notes.txt", "keep me");
    const manifest = await readFile(join(dir, "manifest.json"), "utf8");

    await expect(
      removeAttachment({ story: story.id, id: added.id }, { ...p.ctx, now: () => new Date(Number.NaN) }),
    ).rejects.toThrow(RangeError);

    expect(await readFile(join(dir, `${added.id}.txt`), "utf8")).toBe("keep me");
    expect(await readFile(join(dir, "manifest.json"), "utf8")).toBe(manifest);
    expect(await readdir(dir)).not.toContain(`${added.id}.txt.removed`);
  });

  it("doctor reports a missing file and an orphan file of each type, and keeps the orphans", async () => {
    const { story, dir } = await setup();
    const pdf = await attachFile(story.id, "report.pdf", "%PDF-1.7\n");
    const bare = await attachFile(story.id, "Makefile", "all:\n");
    const orphans = ["a00000000-0000-4000-8000-0000000000aa.zip", "a00000000-0000-4000-8000-0000000000ab"];

    await rename(join(dir, `${pdf.id}.pdf`), join(dir, "elsewhere.pdf"));
    await Promise.all(orphans.map((name) => writeFile(join(dir, name), "orphan")));
    await writeFile(join(dir, `${bare.id}.removed`), "temporary");
    await writeFile(join(dir, ".a1b2.tmp"), "temporary");

    const report = await doctor({}, p.ctx);
    const issues = report.issues.filter((issue) => issue.file?.includes("attachments"));

    expect(issues.map((issue) => issue.message)).toEqual([
      "Attachment report.pdf has no file",
      "Attachment metadata references missing files",
      "Orphan attachment file: preserve it for recovery",
      "Orphan attachment file: preserve it for recovery",
    ]);
    expect(issues[0]?.file).toMatch(new RegExp(`${pdf.id}\\.pdf$`));
    expect(
      issues
        .slice(2)
        .map((issue) => issue.file?.split("/").at(-1))
        .toSorted(),
    ).toEqual(orphans.toSorted());

    await doctor({ fix: true }, p.ctx);

    expect(await listAttachments({ story: story.id }, p.ctx)).toEqual([bare]);
    await Promise.all(orphans.map(async (name) => expect(await readFile(join(dir, name), "utf8")).toBe("orphan")));
  });
});
