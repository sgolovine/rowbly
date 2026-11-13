import { mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  attachmentDir,
  prepareImages,
  readAttachments,
  withAttachments,
} from "../attachment-files/attachment-files.js";
import { doctor } from "../doctor/doctor.js";
import { updateProject } from "../project/project.js";
import { createStory, deleteStory, getStory, searchStories, updateStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { addAttachment, clipboardName, listAttachments, MAX_ATTACHMENT_BYTES, removeAttachment } from "./attachment.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
describe("attachments", () => {
  const p = useTestProject();
  async function setup() {
    const story = await createStory({ title: "Images" }, p.ctx);
    const file = join(p.paths.root, "sample.png");
    await writeFile(file, png);
    return { story, file, dir: await attachmentDir(p.paths, story.id) };
  }
  it("copies files, keeps order and metadata, survives edits, and searches names", async () => {
    const { story, file, dir } = await setup();
    const ctx = { ...p.ctx, now: () => new Date("2026-11-10T18:23:00Z") };
    const first = await addAttachment({ story: story.id, file }, ctx);
    const second = await addAttachment({ story: story.id, image: { name: "other.png", bytes: png } }, ctx);
    expect(first).toMatchObject({
      name: "sample.png",
      type: "image/png",
      size: 9,
      createdAt: "2026-11-10T18:23:00.000Z",
    });
    expect(first?.id).not.toBe(second?.id);
    expect(await readFile(file)).toEqual(png);
    expect(await readFile(join(dir, `${first?.id}.png`))).toEqual(png);
    expect(await listAttachments({ story: "1" }, p.ctx)).toEqual([first, second]);
    await updateStory({ id: story.id, title: "New title", stage: "DONE" }, p.ctx);
    expect((await getStory({ id: story.id }, p.ctx)).attachmentCount).toBe(2);
    expect(await searchStories({ query: "sample.png" }, p.ctx)).toHaveLength(1);
    expect(clipboardName(ctx.now())).toBe("image-20261110-1823.png");
    await removeAttachment({ story: story.id, id: first?.id as string }, p.ctx);
    expect(await readdir(dir)).not.toContain(`${first?.id}.png`);
    expect(await listAttachments({ story: story.id }, p.ctx)).toEqual([second]);
  });
  it("accepts the exact byte limit and rejects invalid or oversized bytes before writes", async () => {
    const { story, dir } = await setup();
    const limit = Buffer.alloc(MAX_ATTACHMENT_BYTES);
    png.copy(limit);
    await addAttachment({ story: story.id, image: { name: "limit.png", bytes: limit } }, p.ctx);
    for (const bytes of [Buffer.alloc(8), Buffer.alloc(MAX_ATTACHMENT_BYTES + 1)]) {
      await expect(addAttachment({ story: story.id, image: { name: "bad.png", bytes } }, p.ctx)).rejects.toMatchObject({
        code: "VALIDATION",
      });
    }
    expect(await readdir(dir)).toHaveLength(2);
  });
  it("reports unknown owners, IDs, invalid sources, and unsafe IDs", async () => {
    const { story, file } = await setup();
    await expect(addAttachment({ story: "999", file }, p.ctx)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(addAttachment({ story: story.id, file, fromClipboard: true }, p.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    await expect(addAttachment({ story: story.id }, p.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      removeAttachment({ story: story.id, id: "a00000000-0000-0000-0000-000000000000" }, p.ctx),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(removeAttachment({ story: story.id, id: "../../outside" }, p.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
  });
  it("saves drafts once, rejects aggregate overflow, and rolls back a failed save", async () => {
    const { story, dir } = await setup();
    const images = prepareImages([{ name: "draft.png", bytes: png }], true);
    await expect(
      withAttachments(dir, images, new Date(), async () => {
        throw new Error("save failed");
      }),
    ).rejects.toThrow("save failed");
    expect(await readdir(dir)).toEqual([]);
    expect(await readAttachments(dir)).toEqual([]);
    await updateStory({ id: story.id, title: "Saved", attachments: images }, p.ctx);
    expect(await listAttachments({ story: story.id }, p.ctx)).toHaveLength(1);
    await expect(updateStory({ id: story.id, title: "", attachments: images }, p.ctx)).rejects.toMatchObject({
      code: "VALIDATION",
    });
    expect((await getStory({ id: story.id }, p.ctx)).title).toBe("Saved");
    expect(await listAttachments({ story: story.id }, p.ctx)).toHaveLength(1);
    const large = Buffer.alloc(MAX_ATTACHMENT_BYTES);
    png.copy(large);
    await expect(
      createStory({ title: "Too many", attachments: [{ name: "a", bytes: large }, ...images] }, p.ctx),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await searchStories({}, p.ctx)).toHaveLength(1);
  });
  it("preserves ownership on key changes and deletes bytes with the Story", async () => {
    const { story, file } = await setup();
    const attachment = await addAttachment({ story: story.id, file }, p.ctx);
    await updateProject({ key: "NEW" }, p.ctx);
    expect(await listAttachments({ story: "NEW-01" }, p.ctx)).toEqual([attachment]);
    await deleteStory({ id: "NEW-01" }, p.ctx);
    expect(await readdir(join(p.paths.dir, "attachments"))).toEqual([]);
  });
  it("doctor repairs missing references and preserves orphans and malformed metadata", async () => {
    const { story, file, dir } = await setup();
    const attachment = await addAttachment({ story: story.id, file }, p.ctx);
    await rm(join(dir, `${attachment?.id}.png`));
    await writeFile(join(dir, "orphan.png"), png);
    const report = await doctor({}, p.ctx);
    expect(report.issues.some((i) => i.message.includes("has no PNG"))).toBe(true);
    expect(report.issues.some((i) => i.message.includes("Orphan PNG"))).toBe(true);
    await doctor({ fix: true }, p.ctx);
    expect(await listAttachments({ story: story.id }, p.ctx)).toEqual([]);
    expect(await readFile(join(dir, "orphan.png"))).toEqual(png);
    await writeFile(join(dir, "manifest.json"), "broken");
    expect((await doctor({ fix: true }, p.ctx)).ok).toBe(false);
    expect(await readFile(join(dir, "manifest.json"), "utf8")).toBe("broken");
  });
  it("doctor reports the issues of a folder in the order of the scan", async () => {
    const { story, file, dir } = await setup();
    const first = await addAttachment({ story: story.id, file }, p.ctx);
    const second = await addAttachment({ story: story.id, file }, p.ctx);
    await rm(join(dir, `${first?.id}.png`));
    await rm(join(dir, `${second?.id}.png`));
    await writeFile(join(dir, "orphan-a.png"), png);
    await writeFile(join(dir, "orphan-b.png"), png);
    const orphans = (await readdir(dir)).filter((name) => name.startsWith("orphan-"));
    const report = await doctor({}, p.ctx);
    const messages = report.issues.filter((i) => i.file?.includes("attachments")).map((i) => i.message);
    expect(messages).toEqual([
      `Attachment ${first?.name} has no PNG`,
      `Attachment ${second?.name} has no PNG`,
      "Attachment metadata references missing PNGs",
      "Orphan PNG: preserve it for recovery",
      "Orphan PNG: preserve it for recovery",
    ]);
    expect(report.issues.filter((i) => i.message.startsWith("Orphan")).map((i) => i.file?.split("/").at(-1))).toEqual(
      orphans,
    );
  });
  it("refuses symlink directories and malicious metadata", async () => {
    const { story, file, dir } = await setup();
    await mkdir(join(p.paths.root, "outside"));
    await mkdir(join(p.paths.dir, "attachments"));
    await symlink(join(p.paths.root, "outside"), dir);
    await expect(addAttachment({ story: story.id, file }, p.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(await readdir(join(p.paths.root, "outside"))).toEqual([]);
    await rm(dir);
    await mkdir(dir);
    await writeFile(join(dir, "manifest.json"), JSON.stringify([{ id: "../../bad" }]));
    await expect(listAttachments({ story: story.id }, p.ctx)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
