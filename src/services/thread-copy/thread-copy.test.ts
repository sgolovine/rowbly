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
      { storyId: story.id, id: own.id },
      { storyId: upstream.id, id: fromUpstream.id },
    ]);
  });

  it("excludes the private runtime files and the PNG files", () => {
    for (const path of ["state.json", "state.json.lock", "runtime/a.json", "attachments/ROW-1/a.png"]) {
      expect(excludedFromCopy(path)).toBe(true);
    }
    for (const path of ["rowbly.config.json", "stories/TODO/ROW-1.md", "attachments/ROW-1/manifest.json"]) {
      expect(excludedFromCopy(path)).toBe(false);
    }
  });
});
