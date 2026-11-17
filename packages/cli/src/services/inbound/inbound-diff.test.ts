import { rm, writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { addAttachment, removeAttachment } from "../attachment/attachment.js";
import { addCustomField } from "../custom-field/custom-field.js";
import { createStory, deleteStory, updateStory } from "../story/story.js";
import { addTag } from "../tag/tag.js";
import { useTestProject } from "../test-project/test-project.js";
import { buildThreadCopy } from "../thread-copy/thread-copy.js";
import { copyFileKind, inboundDiff } from "./inbound-diff.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe("inboundDiff", () => {
  const project = useTestProject();

  async function setup() {
    await addCustomField({ label: "Owner", type: "string", key: "owner" }, project.ctx);
    await addTag({ label: "Bug", value: "bug" }, project.ctx);
    const own = await createStory({ title: "Own" }, project.ctx);
    const other = await createStory({ title: "Other" }, project.ctx);
    const gone = await createStory({ title: "Gone" }, project.ctx);
    const old = (await addAttachment({ story: own.id, image: { name: "old.png", bytes: PNG } }, project.ctx)) as {
      id: string;
    };
    const base = await buildThreadCopy({ storyId: own.id }, project.ctx);
    return { own, other, gone, old, base, fieldKeys: ["owner"] };
  }

  it("gives one update for each changed path of a Story, with before and after", async () => {
    const f = await setup();
    await updateStory(
      {
        id: f.own.id,
        title: "New title",
        description: "New text",
        stage: "DONE",
        fields: { owner: "ana" },
        tags: ["bug"],
        dependsOn: [f.other.id],
      },
      project.ctx,
    );
    const current = await buildThreadCopy({ storyId: f.own.id }, project.ctx);

    const updates = inboundDiff({ base: f.base, current, fieldKeys: f.fieldKeys });

    expect(updates).toEqual([
      {
        type: "story.update",
        storyId: f.own.id,
        ...(f.own.uid ? { storyUid: f.own.uid } : {}),
        changes: [
          { path: "title", before: "Own", after: "New title" },
          { path: "description", before: "", after: "New text" },
          { path: "stage", before: "BACKLOG", after: "DONE" },
          { path: "fields.owner", before: null, after: "ana" },
          { path: "tags", before: [], after: ["bug"] },
          { path: "dependsOn", before: [], after: [f.other.id] },
        ],
      },
    ]);
  });

  it("gives story.create, story.delete, attachment.add with the file for the Story of the Thread, and attachment.remove", async () => {
    const f = await setup();
    const added = await createStory({ title: "New" }, project.ctx);
    await deleteStory({ id: f.gone.id }, project.ctx);
    const own = (await addAttachment({ story: f.own.id, image: { name: "new.png", bytes: PNG } }, project.ctx)) as {
      id: string;
    };
    const other = (await addAttachment({ story: f.other.id, image: { name: "o.png", bytes: PNG } }, project.ctx)) as {
      id: string;
    };
    await removeAttachment({ story: f.own.id, id: f.old.id }, project.ctx);
    const current = await buildThreadCopy({ storyId: f.own.id }, project.ctx);

    const updates = inboundDiff({ base: f.base, current, fieldKeys: f.fieldKeys });

    expect(updates.map((update) => update.type)).toEqual([
      "story.create",
      "attachment.add",
      "attachment.remove",
      "attachment.add",
      "story.delete",
    ]);
    expect(updates[0]).toEqual({
      type: "story.create",
      storyId: added.id,
      path: `.rowbly/stories/BACKLOG/${added.id}.md`,
      content: expect.stringContaining("title: New"),
    });
    expect(updates[1]).toMatchObject({
      type: "attachment.add",
      storyId: f.own.id,
      attachment: { id: own.id, name: "new.png" },
      file: `${own.id}.png`,
    });
    expect(updates[2]).toEqual({ type: "attachment.remove", storyId: f.own.id, id: f.old.id });
    expect(updates[3]).toMatchObject({ type: "attachment.add", storyId: f.other.id, attachment: { id: other.id } });
    expect(updates[3]).not.toHaveProperty("file");
    expect(updates[4]).toEqual({ type: "story.delete", storyId: f.gone.id });
  });

  it("gives file.put for a changed config and Stage prompt, and file.delete for a removed file", async () => {
    const f = await setup();
    await writeFile(project.path("stages/BACKLOG.md"), "New Stage prompt\n");
    await rm(project.path("stages/DONE.md"));
    const current = await buildThreadCopy({ storyId: f.own.id }, project.ctx);

    expect(inboundDiff({ base: f.base, current, fieldKeys: f.fieldKeys })).toEqual([
      { type: "file.put", path: ".rowbly/stages/BACKLOG.md", content: "New Stage prompt\n" },
      { type: "file.delete", path: ".rowbly/stages/DONE.md" },
    ]);

    await addTag({ label: "Feature", value: "feature" }, project.ctx);
    const withTag = await buildThreadCopy({ storyId: f.own.id }, project.ctx);
    const updates = inboundDiff({ base: current, current: withTag, fieldKeys: f.fieldKeys });

    expect(updates).toEqual([
      { type: "file.put", path: ".rowbly/rowbly.config.json", content: await project.read("rowbly.config.json") },
    ]);
  });

  it("gives no update for the same files, and no update for a change of a value that is not recorded", async () => {
    const f = await setup();

    expect(inboundDiff({ base: f.base, current: f.base, fieldKeys: f.fieldKeys })).toEqual([]);

    const touched = {
      ...f.base,
      files: f.base.files.map((file) =>
        copyFileKind(file.path).kind === "story"
          ? { ...file, content: file.content.replace(/updatedAt: .*/, "updatedAt: 2030-01-01T00:00:00.000Z") }
          : file,
      ),
    };
    expect(inboundDiff({ base: f.base, current: touched, fieldKeys: f.fieldKeys })).toEqual([]);
  });

  it("knows the kind of each copy path", () => {
    expect(copyFileKind(".rowbly/stories/BACKLOG/ROW-01.md")).toEqual({ kind: "story", storyId: "ROW-01" });
    expect(copyFileKind(".rowbly/stories/ROW-01.md")).toEqual({ kind: "story", storyId: "ROW-01" });
    expect(copyFileKind(".rowbly/attachments/ROW-01/manifest.json")).toEqual({ kind: "manifest", storyId: "ROW-01" });
    expect(copyFileKind(".rowbly/stages/BACKLOG.md")).toEqual({ kind: "other" });
    expect(copyFileKind(".rowbly/specs/a.md")).toEqual({ kind: "other" });
  });
});
