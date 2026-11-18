import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { attachmentDir, readAttachments } from "../attachment-files/attachment-files.js";
import { createStory, updateStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { addAttachment, listAttachments } from "./attachment.js";

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 1]);
const ID = `a${"1".repeat(36)}`;

describe("the Story uid of attachment records", () => {
  const p = useTestProject();

  /** Removes the `uid` line of a Story file, as in a file of an older build. */
  async function removeUid(path: string): Promise<void> {
    await p.write(path, (await p.read(path)).replace(/\nuid: [^\n]*\n/, "\n"));
  }

  it("gives each new record the uid of its Story", async () => {
    const story = await createStory({ title: "Images", attachments: [{ name: "first.png", bytes: png }] }, p.ctx);
    await updateStory({ id: story.id, attachments: [{ name: "second.png", bytes: png }] }, p.ctx);
    const added = await addAttachment({ story: story.id, image: { name: "third.png", bytes: png } }, p.ctx);

    const records = await listAttachments({ story: story.id }, p.ctx);

    expect(story.uid).toEqual(expect.any(String));
    expect(added.storyUid).toBe(story.uid);
    expect(records.map((record) => record.storyUid)).toEqual([story.uid, story.uid, story.uid]);
    const manifest = JSON.parse(await p.read("attachments/ROW-01/manifest.json"));
    expect(manifest.map((record: { storyUid?: string }) => record.storyUid)).toEqual([story.uid, story.uid, story.uid]);
  });

  it("gives a record without a storyUid for a Story without a uid, with no error", async () => {
    await createStory({ title: "Old" }, p.ctx);
    await removeUid("stories/BACKLOG/ROW-01.md");

    const added = await addAttachment({ story: "ROW-01", image: { name: "a.png", bytes: png } }, p.ctx);

    expect("storyUid" in added).toBe(false);
    expect(await listAttachments({ story: "ROW-01" }, p.ctx)).toEqual([added]);
  });

  it("reads an old record without a storyUid, and refuses a storyUid that is not a string", async () => {
    await createStory({ title: "Images" }, p.ctx);
    const dir = await attachmentDir(p.paths, "ROW-01");
    const old = { id: ID, name: "old.png", type: "image/png", size: 9, createdAt: "2026-11-10T18:23:00.000Z" };
    await addAttachment({ story: "ROW-01", image: { name: "new.png", bytes: png } }, p.ctx);
    const [added] = await readAttachments(dir);

    await writeFile(join(dir, "manifest.json"), JSON.stringify([old, added]));
    expect(await readAttachments(dir)).toEqual([old, added]);

    await writeFile(join(dir, "manifest.json"), JSON.stringify([{ ...old, storyUid: 7 }]));
    await expect(readAttachments(dir)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
