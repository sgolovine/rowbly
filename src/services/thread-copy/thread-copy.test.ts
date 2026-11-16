import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addAttachment } from "../attachment/attachment.js";
import { createStory } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { buildThreadCopy, excludedFromCopy } from "./thread-copy.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

describe("thread copy", () => {
  const project = useTestProject();

  async function attach(story: string) {
    return addAttachment({ story, image: { name: "shot.png", bytes: PNG } }, project.ctx);
  }

  it("has the tracked files without state.json, runtime/ and PNG files", async () => {
    const upstream = await createStory({ title: "Upstream" }, project.ctx);
    const other = await createStory({ title: "Other" }, project.ctx);
    const story = await createStory({ title: "Work", dependsOn: [upstream.id] }, project.ctx);
    await project.write("specs/plan.md", "# Plan\n");
    const own = await attach(story.id);
    const fromUpstream = await attach(upstream.id);
    await attach(other.id);
    await project.write("state.json", "{}");
    await project.write("state.json.lock", "");
    await project.write("runtime/status.json", "{}");
    await project.write("prompts/WORKER.md", "Worker prompt");

    const copy = await buildThreadCopy({ storyId: story.id }, project.ctx);
    const paths = copy.files.map((file) => file.path);

    expect(paths).toEqual(expect.arrayContaining([".rowbly/rowbly.config.json", ".rowbly/prompts/WORKER.md"]));
    expect(paths.some((path) => path.startsWith(".rowbly/stories/") && path.endsWith(`${story.id}.md`))).toBe(true);
    expect(paths.some((path) => path.startsWith(".rowbly/stages/"))).toBe(true);
    expect(paths.some((path) => path.startsWith(".rowbly/specs/"))).toBe(true);
    expect(paths).toContain(`.rowbly/attachments/${story.id}/manifest.json`);
    expect(paths.every((path) => path.startsWith(".rowbly/"))).toBe(true);
    expect(paths.some((path) => path.includes("state.json"))).toBe(false);
    expect(paths.some((path) => path.startsWith(".rowbly/runtime/"))).toBe(false);
    expect(paths.some((path) => path.endsWith(".png"))).toBe(false);
    expect(copy.files.find((file) => file.path === ".rowbly/prompts/WORKER.md")?.content).toBe("Worker prompt");
    expect(copy.attachments).toEqual([
      { storyId: story.id, id: own.id, file: `${own.id}.png` },
      { storyId: upstream.id, id: fromUpstream.id, file: `${fromUpstream.id}.png` },
    ]);
  });

  it("lists an attachment file of a different type with its file name and does not send it as text", async () => {
    const story = await createStory({ title: "Work" }, project.ctx);
    const pdf = await addAttachment(
      { story: story.id, image: { name: "report.pdf", bytes: Buffer.from("%PDF-1.7") } },
      project.ctx,
    );
    const raw = await addAttachment(
      { story: story.id, image: { name: "blob", bytes: Buffer.from([0, 1, 2, 255]) } },
      project.ctx,
    );
    const dir = join(project.paths.dir, "attachments", story.id);
    expect((await readdir(dir)).toSorted()).toEqual([`${pdf.id}.pdf`, raw.id, "manifest.json"].toSorted());

    const copy = await buildThreadCopy({ storyId: story.id }, project.ctx);
    const paths = copy.files.map((file) => file.path);

    expect(paths.filter((path) => path.startsWith(`.rowbly/attachments/${story.id}/`))).toEqual([
      `.rowbly/attachments/${story.id}/manifest.json`,
    ]);
    expect(copy.attachments).toEqual([
      { storyId: story.id, id: pdf.id, file: `${pdf.id}.pdf` },
      { storyId: story.id, id: raw.id, file: raw.id },
    ]);
  });

  it("excludes the private runtime files and all attachment files", () => {
    const excluded = [
      "state.json",
      "state.json.lock",
      "runtime/a.json",
      "attachments/ROW-1/a.png",
      "attachments/ROW-1/a.pdf",
      "attachments/ROW-1/a",
      "attachments/ROW-1/x/manifest.json",
    ];
    for (const path of excluded) {
      expect(excludedFromCopy(path)).toBe(true);
    }
    for (const path of ["rowbly.config.json", "stories/TODO/ROW-1.md", "attachments/ROW-1/manifest.json"]) {
      expect(excludedFromCopy(path)).toBe(false);
    }
  });
});
