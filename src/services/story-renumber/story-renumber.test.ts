import { mkdir, readdir, utimes } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { pathExists } from "../files/files.js";
import { useTestProject } from "../test-project/test-project.js";
import { findDuplicateStoryIds, renumberNotice, repairDuplicateStoryIds } from "./story-renumber.js";

const NOW = new Date("2026-11-16T12:00:00.000Z");

const STAGES = [
  { key: "BACKLOG", label: "Backlog", prompt: "" },
  { key: "IN_DEVELOPMENT", label: "In development", prompt: "" },
  { key: "DONE", label: "Done", prompt: "" },
];

const CUSTOM_FIELDS = [
  { key: "points", label: "Points", type: "number" as const },
  { key: "worktree", label: "Worktree", type: "string" as const },
  { key: "pull_request", label: "Pull request", type: "url" as const },
];

interface StoryText {
  title: string;
  stage: string;
  createdAt?: string;
  extra?: string;
  body?: string;
}

function storyText({ title, stage, createdAt, extra, body }: StoryText): string {
  const lines = [
    `title: ${title}`,
    `stage: ${stage}`,
    "position: 2",
    ...(createdAt ? [`createdAt: ${createdAt}`] : []),
    ...(extra ? [extra] : []),
  ];

  return `---\n${lines.join("\n")}\n---\n\n${body ?? `${title} body.`}\n`;
}

function stateFile(attempts: { story: string; stage: string }[]): string {
  const full = attempts.map((attempt) => ({ ...attempt, workerId: "worker-1", status: "running" }));

  return JSON.stringify({ version: 1, updatedAt: null, scan: { stages: {} }, attempts: full });
}

describe("story renumber", () => {
  const project = useTestProject({ name: "Rowbly", key: "ROW", stages: STAGES, customFields: CUSTOM_FIELDS });
  const ctx = () => ({ ...project.ctx, now: () => NOW });
  const repair = () => repairDuplicateStoryIds(ctx());

  const tags = "stories/BACKLOG/ROW-77.md";
  const sidebar = "stories/IN_DEVELOPMENT/ROW-77.md";
  const tagsText = storyText({ title: "Tags", stage: "BACKLOG", createdAt: "2026-01-01T00:00:00.000Z" });
  const sidebarText = storyText({
    title: "Sidebar",
    stage: "IN_DEVELOPMENT",
    createdAt: "2026-02-01T00:00:00.000Z",
    extra: "points: 3",
  });

  const writeRow77 = async () => {
    await project.write(tags, tagsText);
    await project.write(sidebar, sidebarText);
    await project.write("stories/DONE/ROW-78.md", storyText({ title: "Last", stage: "DONE" }));
  };

  it("gives the newer Story the next free number and keeps all its other values", async () => {
    await writeRow77();

    const result = await repair();

    expect(result).toEqual({
      changes: [
        {
          from: "ROW-77",
          to: "ROW-79",
          path: project.path("stories/IN_DEVELOPMENT/ROW-79.md"),
          previousPath: project.path(sidebar),
          keptPath: project.path(tags),
        },
      ],
      unrepaired: [],
    });
    expect(renumberNotice(result.changes[0] as { from: string; to: string })).toBe("ROW-77 → ROW-79: duplicate ID");
    expect(await project.read(tags)).toBe(tagsText);
    expect(await pathExists(project.path(sidebar))).toBe(false);
    expect(await project.read("stories/IN_DEVELOPMENT/ROW-79.md")).toBe(
      "---\ntitle: Sidebar\nstage: IN_DEVELOPMENT\nposition: 2\ncreatedAt: 2026-02-01T00:00:00.000Z\n" +
        "updatedAt: 2026-11-16T12:00:00.000Z\npoints: 3\n---\n\nSidebar body.\n",
    );
    expect(await repair()).toEqual({ changes: [], unrepaired: [] });
  });

  it("plans the repair without a change of a file", async () => {
    await writeRow77();

    const plan = await findDuplicateStoryIds(ctx());

    expect(plan.unrepaired).toEqual([]);
    expect(plan.groups.map((group) => [group.id, group.keep.path, group.renumber.map((file) => file.to)])).toEqual([
      ["ROW-77", project.path(tags), ["ROW-79"]],
    ]);
    expect(await project.read(sidebar)).toBe(sidebarText);
  });

  it("treats a Story without createdAt as older than a Story with createdAt", async () => {
    await project.write(
      "stories/BACKLOG/ROW-05.md",
      storyText({ title: "New", stage: "BACKLOG", createdAt: "2020-01-01T00:00:00.000Z" }),
    );
    await project.write("stories/DONE/ROW-05.md", storyText({ title: "Old", stage: "DONE" }));

    const { changes } = await repair();

    expect(changes.map((change) => [change.from, change.to, change.path])).toEqual([
      ["ROW-05", "ROW-06", project.path("stories/BACKLOG/ROW-06.md")],
    ]);
  });

  it("uses the modification time, then the path, when createdAt is equal", async () => {
    const createdAt = "2026-01-01T00:00:00.000Z";
    await project.write("stories/BACKLOG/ROW-05.md", storyText({ title: "A", stage: "BACKLOG", createdAt }));
    await project.write("stories/DONE/ROW-05.md", storyText({ title: "B", stage: "DONE", createdAt }));
    await project.write(
      "stories/IN_DEVELOPMENT/ROW-05.md",
      storyText({ title: "C", stage: "IN_DEVELOPMENT", createdAt }),
    );
    await utimes(project.path("stories/BACKLOG/ROW-05.md"), 2000, 2000);
    await utimes(project.path("stories/DONE/ROW-05.md"), 1000, 1000);
    await utimes(project.path("stories/IN_DEVELOPMENT/ROW-05.md"), 2000, 2000);

    const plan = await findDuplicateStoryIds(ctx());

    expect(plan.groups[0]?.keep.path).toBe(project.path("stories/DONE/ROW-05.md"));
    // BACKLOG comes before IN_DEVELOPMENT in string order.
    expect(plan.groups[0]?.renumber.map((file) => [file.path, file.to])).toEqual([
      [project.path("stories/BACKLOG/ROW-05.md"), "ROW-06"],
      [project.path("stories/IN_DEVELOPMENT/ROW-05.md"), "ROW-07"],
    ]);
  });

  it("gives two new numbers in sequence for three files with the same number", async () => {
    await project.write(
      "stories/BACKLOG/ROW-77.md",
      storyText({ title: "A", stage: "BACKLOG", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    await project.write(
      "stories/DONE/ROW-77.md",
      storyText({ title: "B", stage: "DONE", createdAt: "2026-03-01T00:00:00.000Z" }),
    );
    await project.write(
      "stories/IN_DEVELOPMENT/ROW-77.md",
      storyText({ title: "C", stage: "IN_DEVELOPMENT", createdAt: "2026-02-01T00:00:00.000Z" }),
    );
    await project.write("stories/DONE/ROW-78.md", storyText({ title: "Last", stage: "DONE" }));

    const { changes } = await repair();

    expect(changes.map((change) => [change.from, change.to, change.path])).toEqual([
      ["ROW-77", "ROW-79", project.path("stories/IN_DEVELOPMENT/ROW-79.md")],
      ["ROW-77", "ROW-80", project.path("stories/DONE/ROW-80.md")],
    ]);
    expect(await pathExists(project.path("stories/BACKLOG/ROW-77.md"))).toBe(true);
    expect(await readdir(project.path("stories/DONE"))).toEqual(["ROW-78.md", "ROW-80.md"]);
  });

  it("finds ROW-7 and ROW-07 as duplicates, and writes the canonical name", async () => {
    await project.write(
      "stories/BACKLOG/ROW-07.md",
      storyText({ title: "A", stage: "BACKLOG", createdAt: "2026-01-01T00:00:00.000Z" }),
    );
    await project.write(
      "stories/BACKLOG/ROW-7.md",
      storyText({ title: "B", stage: "BACKLOG", createdAt: "2026-02-01T00:00:00.000Z" }),
    );

    const { changes } = await repair();

    expect(changes.map((change) => [change.from, change.to, change.path])).toEqual([
      ["ROW-7", "ROW-08", project.path("stories/BACKLOG/ROW-08.md")],
    ]);
    expect(await readdir(project.path("stories/BACKLOG"))).toEqual(["ROW-07.md", "ROW-08.md"]);
  });

  it("gives the new number to the older Story when only the newer Story has factory state", async () => {
    await project.write(tags, tagsText);
    await project.write(sidebar, sidebarText.replace("points: 3", "worktree: /tmp/ROW-77"));

    const { changes } = await repair();

    expect(changes.map((change) => [change.previousPath, change.path])).toEqual([
      [project.path(tags), project.path("stories/BACKLOG/ROW-78.md")],
    ]);
    expect(await pathExists(project.path(sidebar))).toBe(true);
  });

  it("reads the attempts of state.json as factory state", async () => {
    await writeRow77();
    await project.write("state.json", stateFile([{ story: "ROW-77", stage: "IN_DEVELOPMENT" }]));

    const { changes } = await repair();

    expect(changes.map((change) => change.previousPath)).toEqual([project.path(tags)]);
  });

  it("does not repair a group in which more than one Story has factory state", async () => {
    await project.write(tags, tagsText.replace("position: 2", "position: 2\npull_request: https://example.com/1"));
    await project.write(sidebar, sidebarText);
    await project.write("state.json", stateFile([{ story: "ROW-77", stage: "IN_DEVELOPMENT" }]));

    const result = await repair();

    expect(result).toEqual({
      changes: [],
      unrepaired: [
        {
          id: "ROW-77",
          paths: [project.path(tags), project.path(sidebar)],
          reason: "More than one Story with this ID has factory state",
        },
      ],
    });
    expect(await project.read(sidebar)).toBe(sidebarText);
  });

  it("ignores an invalid state file", async () => {
    await writeRow77();
    await project.write("state.json", "{ not json");

    const { changes } = await repair();

    expect(changes.map((change) => change.to)).toEqual(["ROW-79"]);
  });

  it("does not change dependsOn lists, Spec links or the attachment folder", async () => {
    await writeRow77();
    const dependent = "---\ntitle: Dependent\nstage: BACKLOG\ndependsOn:\n  - ROW-77\n---\n\nBody\n";
    const spec = "---\ntitle: Design\nstories: [ROW-77]\n---\n\nBody\n";
    await project.write("stories/BACKLOG/ROW-80.md", dependent);
    await project.write("specs/design.md", spec);
    await project.write("attachments/ROW-77/image.png", "png");

    const { changes } = await repair();

    expect(changes.map((change) => change.to)).toEqual(["ROW-81"]);
    expect(await project.read("stories/BACKLOG/ROW-80.md")).toBe(dependent);
    expect(await project.read("specs/design.md")).toBe(spec);
    expect(await project.read("attachments/ROW-77/image.png")).toBe("png");
    expect(await pathExists(project.path("attachments/ROW-81"))).toBe(false);
  });

  it("does not repair a Story whose file changed after the plan", async () => {
    await writeRow77();
    const plan = await findDuplicateStoryIds(ctx());
    const changed = sidebarText.replace("Sidebar body.", "Edited.");
    await project.write(sidebar, changed);

    const result = await repairDuplicateStoryIds(ctx(), plan);

    expect(result.changes).toEqual([]);
    expect(result.unrepaired.map((item) => item.reason)).toEqual(["The Story file changed after the plan"]);
    expect(await project.read(sidebar)).toBe(changed);
    expect(await readdir(project.path("stories/IN_DEVELOPMENT"))).toEqual(["ROW-77.md"]);
  });

  it("does not create a Story when its file disappeared after the plan", async () => {
    await writeRow77();
    const plan = await findDuplicateStoryIds(ctx());
    const first = await repairDuplicateStoryIds(ctx());

    const second = await repairDuplicateStoryIds(ctx(), plan);

    expect(first.changes.map((change) => change.to)).toEqual(["ROW-79"]);
    expect(second.changes).toEqual([]);
    expect(second.unrepaired.map((item) => item.reason)).toEqual(["The Story file changed after the plan"]);
    expect(await readdir(project.path("stories/IN_DEVELOPMENT"))).toEqual(["ROW-79.md"]);
  });

  it("tries the next number one time when the target exists, and never overwrites it", async () => {
    await writeRow77();
    // A folder with a Story file name is not a Story file, so the next free number stays 79.
    await mkdir(project.path("stories/IN_DEVELOPMENT/ROW-79.md"), { recursive: true });

    const once = await repair();

    expect(once.changes.map((change) => change.path)).toEqual([project.path("stories/IN_DEVELOPMENT/ROW-80.md")]);

    await project.write("stories/IN_DEVELOPMENT/ROW-77.md", sidebarText);
    await mkdir(project.path("stories/IN_DEVELOPMENT/ROW-81.md"), { recursive: true });
    await mkdir(project.path("stories/IN_DEVELOPMENT/ROW-82.md"), { recursive: true });

    const twice = await repair();

    expect(twice.changes).toEqual([]);
    expect(twice.unrepaired.map((item) => item.reason)).toEqual(["A file exists at the path of the next free number"]);
    expect(await project.read(sidebar)).toBe(sidebarText);
  });

  it("gives an empty result and changes no file when no ID is used twice", async () => {
    await project.write(tags, tagsText);
    await project.write("stories/BACKLOG/ROW-78.md", sidebarText);

    expect(await findDuplicateStoryIds(ctx())).toEqual({ groups: [], unrepaired: [] });
    expect(await repair()).toEqual({ changes: [], unrepaired: [] });
    expect(await project.read(tags)).toBe(tagsText);
    expect(await project.read("stories/BACKLOG/ROW-78.md")).toBe(sidebarText);
  });

  it("does not repair a group with a file that cannot be read", async () => {
    await project.write(tags, tagsText);
    await project.write(sidebar, "---\ntitle: [oops\n---\n");

    const result = await repair();

    expect(result.changes).toEqual([]);
    expect(result.unrepaired.map((item) => item.reason)).toEqual(["A Story file of the group cannot be read"]);
  });
});
