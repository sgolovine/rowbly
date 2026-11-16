import { mkdir, readdir, rm, utimes } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { pathExists } from "../files/files.js";
import { useTestProject } from "../test-project/test-project.js";
import { copyNotice, findDuplicateStoryIds, renumberNotice, repairDuplicateStoryIds } from "./story-renumber.js";

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
      removed: [],
      changes: [
        {
          from: "ROW-77",
          to: "ROW-79",
          path: project.path("stories/IN_DEVELOPMENT/ROW-79.md"),
          previousPath: project.path(sidebar),
          keptPath: project.path(tags),
          movedAttachments: [],
          stayed: { dependents: [], specs: [], attachments: [], attempts: 0 },
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
    expect(await repair()).toEqual({ removed: [], changes: [], unrepaired: [] });
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
      removed: [],
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

    expect(changes.map((change) => [change.to, change.movedAttachments, change.stayed])).toEqual([
      [
        "ROW-81",
        [],
        {
          dependents: [project.path("stories/BACKLOG/ROW-80.md")],
          specs: [project.path("specs/design.md")],
          attachments: [],
          attempts: 0,
        },
      ],
    ]);
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

    expect(await findDuplicateStoryIds(ctx())).toEqual({ copies: [], groups: [], unrepaired: [] });
    expect(await repair()).toEqual({ removed: [], changes: [], unrepaired: [] });
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

describe("story copies", () => {
  const project = useTestProject({
    name: "Rowbly",
    key: "ROW",
    stages: [...STAGES, { key: "IN_REVIEW", label: "In review", prompt: "" }],
    customFields: CUSTOM_FIELDS,
  });
  const ctx = () => ({ ...project.ctx, now: () => NOW });
  const repair = () => repairDuplicateStoryIds(ctx());

  const uid = "8a3c3f0e-6a55-4f43-9a0b-6f5b1e2d7c11";
  const done = "stories/DONE/ROW-78.md";
  const review = "stories/IN_REVIEW/ROW-78.md";

  interface CopyText {
    stage: string;
    updatedAt?: string;
    title?: string;
    body?: string;
    position?: number;
  }

  const copyText = ({ stage, updatedAt, title, body, position }: CopyText): string =>
    [
      "---",
      `title: ${title ?? "Search"}`,
      `stage: ${stage}`,
      `position: ${position ?? 1}`,
      `uid: ${uid}`,
      "createdAt: 2026-11-01T00:00:00.000Z",
      ...(updatedAt ? [`updatedAt: ${updatedAt}`] : []),
      "worktree: /tmp/ROW-78",
      "pull_request: https://example.com/78",
      "---",
      "",
      body ?? "Search body.",
      "",
    ].join("\n");

  const doneText = copyText({ stage: "DONE", updatedAt: "2026-11-16T10:00:00.000Z", position: 3 });
  const reviewText = copyText({ stage: "IN_REVIEW", updatedAt: "2026-11-16T11:00:00.000Z" });

  it("removes the copy with the older updatedAt and keeps the newer copy without a change", async () => {
    await project.write(done, doneText);
    await project.write(review, reviewText);

    const result = await repair();

    expect(result).toEqual({
      removed: [{ id: "ROW-78", stage: "DONE", path: project.path(done), keptPath: project.path(review) }],
      changes: [],
      unrepaired: [],
    });
    expect(copyNotice(result.removed[0] as { id: string; stage: string })).toBe("ROW-78: removed the old copy in DONE");
    expect(await pathExists(project.path(done))).toBe(false);
    expect(await pathExists(project.path("stories/DONE"))).toBe(false);
    expect(await project.read(review)).toBe(reviewText);
    expect(await repair()).toEqual({ removed: [], changes: [], unrepaired: [] });
  });

  it("does not change copies with a different body or title, and reports them as not repaired", async () => {
    const bodyText = copyText({ stage: "IN_REVIEW", updatedAt: "2026-11-16T11:00:00.000Z", body: "Edited." });
    const titleText = copyText({ stage: "IN_REVIEW", updatedAt: "2026-11-16T11:00:00.000Z", title: "Find" });

    for (const other of [bodyText, titleText]) {
      await project.write(done, doneText);
      await project.write(review, other);

      const result = await repair();

      expect(result).toEqual({
        removed: [],
        changes: [],
        unrepaired: [
          {
            id: "ROW-78",
            paths: [project.path(done), project.path(review)],
            reason: "The copies of the Story have different content. Merge them",
          },
        ],
      });
      expect(await project.read(done)).toBe(doneText);
      expect(await project.read(review)).toBe(other);
    }
  });

  it("removes no file when a copy changed or disappeared after the plan", async () => {
    await project.write(done, doneText);
    await project.write(review, reviewText);
    const plan = await findDuplicateStoryIds(ctx());
    const edited = reviewText.replace("Search body.", "Edited.");
    await project.write(review, edited);

    const changed = await repairDuplicateStoryIds(ctx(), plan);

    expect(changed.removed).toEqual([]);
    expect(changed.unrepaired.map((item) => item.reason)).toEqual(["A copy of the Story changed after the plan"]);
    expect(await project.read(done)).toBe(doneText);
    expect(await project.read(review)).toBe(edited);

    await project.write(review, reviewText);
    const second = await findDuplicateStoryIds(ctx());
    await rm(project.path(review));

    const gone = await repairDuplicateStoryIds(ctx(), second);

    expect(gone.removed).toEqual([]);
    expect(gone.unrepaired.map((item) => item.reason)).toEqual(["A copy of the Story changed after the plan"]);
    expect(await project.read(done)).toBe(doneText);
  });

  it("uses the modification time, then the path, when updatedAt is equal", async () => {
    const updatedAt = "2026-11-16T10:00:00.000Z";
    const backlog = "stories/BACKLOG/ROW-78.md";
    await project.write(backlog, copyText({ stage: "BACKLOG", updatedAt }));
    await project.write(done, copyText({ stage: "DONE", updatedAt }));
    await project.write(review, copyText({ stage: "IN_REVIEW", updatedAt }));
    await utimes(project.path(backlog), 1000, 1000);
    await utimes(project.path(done), 2000, 2000);
    await utimes(project.path(review), 2000, 2000);

    const plan = await findDuplicateStoryIds(ctx());

    // DONE comes before IN_REVIEW in string order.
    expect(plan.copies).toMatchObject([
      {
        id: "ROW-78",
        keep: { path: project.path(done) },
        remove: [{ path: project.path(review) }, { path: project.path(backlog) }],
      },
    ]);
    expect(plan.groups).toEqual([]);

    const { removed } = await repairDuplicateStoryIds(ctx(), plan);

    expect(removed.map((removal) => removal.stage)).toEqual(["IN_REVIEW", "BACKLOG"]);
    expect(await pathExists(project.path(done))).toBe(true);
  });

  it("removes the copies first, and gives the files that stay to the re-number rules", async () => {
    await project.write(done, doneText);
    await project.write(review, reviewText);
    await project.write(
      "stories/BACKLOG/ROW-78.md",
      "---\ntitle: Other\nstage: BACKLOG\ncreatedAt: 2026-11-10T00:00:00.000Z\n---\n\nOther.\n",
    );

    const result = await repair();

    expect(result.removed.map((removal) => removal.path)).toEqual([project.path(done)]);
    expect(result.changes.map((change) => [change.previousPath, change.to])).toEqual([
      [project.path("stories/BACKLOG/ROW-78.md"), "ROW-79"],
    ]);
    expect(await project.read(review)).toBe(reviewText);
  });
});
