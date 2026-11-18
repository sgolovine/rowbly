import { execFile } from "node:child_process";
import { readdir, rm } from "node:fs/promises";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { PolicyAttempt } from "../factory-policy/factory-policy.js";
import { attemptRef } from "../factory-policy/policy-records.js";
import { pathExists } from "../files/files.js";
import { getStory, listStoryRefs, matchStoryRef } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import { createThread } from "../thread/thread-change.js";
import { listThreads } from "../thread/thread-list.js";
import { defaultWorktreePath, prepareWorkerWorktree } from "../worker-worktree/worker-worktree.js";
import { repairDuplicateStoryIds } from "./story-renumber.js";

const exec = promisify(execFile);

const NOW = new Date("2026-11-16T12:00:00.000Z");
const OLDER_UID = "11111111-1111-4111-8111-111111111111";
const NEWER_UID = "22222222-2222-4222-8222-222222222222";

const STAGES = [
  { key: "BACKLOG", label: "Backlog", prompt: "" },
  { key: "IN_DEVELOPMENT", label: "In development", prompt: "" },
  { key: "DONE", label: "Done", prompt: "" },
];

const CUSTOM_FIELDS = [
  { key: "worktree", label: "Worktree", type: "string" as const },
  { key: "pull_request", label: "Pull request", type: "url" as const },
];

interface StoryText {
  title: string;
  stage: string;
  createdAt: string;
  uid?: string;
  extra?: string[];
}

function storyText({ title, stage, createdAt, uid, extra }: StoryText): string {
  const lines = [
    `title: ${title}`,
    `stage: ${stage}`,
    ...(uid ? [`uid: ${uid}`] : []),
    `createdAt: ${createdAt}`,
    ...(extra ?? []),
  ];

  return `---\n${lines.join("\n")}\n---\n\n${title} body.\n`;
}

function attempt(fields: Partial<PolicyAttempt>): PolicyAttempt {
  return { story: "ROW-77", stage: "IN_DEVELOPMENT", workerId: "worker-1", status: "completed", ...fields };
}

function stateFile(attempts: PolicyAttempt[]): string {
  return JSON.stringify({ version: 1, updatedAt: null, scan: { stages: {} }, attempts });
}

function attachmentRecord(id: string, name: string, storyUid?: string) {
  return {
    id,
    name,
    type: "image/png",
    size: 3,
    createdAt: "2026-11-01T00:00:00.000Z",
    ...(storyUid ? { storyUid } : {}),
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const identity = ["-c", "user.name=Test", "-c", "user.email=test@example.com"];

  return (await exec("git", ["-C", cwd, ...identity, ...args])).stdout.trim();
}

describe("story renumber of Stories with a uid", () => {
  const project = useTestProject({ name: "Rowbly", key: "ROW", stages: STAGES, customFields: CUSTOM_FIELDS });
  const ctx = () => ({ ...project.ctx, now: () => NOW });
  const repair = () => repairDuplicateStoryIds(ctx());
  // The default worktree folder is next to the Project folder, outside the temporary folder of the test.
  afterEach(() => rm(`${project.paths.root}-worktrees`, { recursive: true, force: true }));

  const older = "stories/DONE/ROW-77.md";
  const newer = "stories/IN_DEVELOPMENT/ROW-77.md";
  const olderText = storyText({
    title: "Tags",
    stage: "DONE",
    createdAt: "2026-01-01T00:00:00.000Z",
    uid: OLDER_UID,
    extra: ["pull_request: https://example.com/77"],
  });
  const newerText = (extra: string[] = []) =>
    storyText({
      title: "Sidebar",
      stage: "IN_DEVELOPMENT",
      createdAt: "2026-02-01T00:00:00.000Z",
      uid: NEWER_UID,
      extra,
    });

  const writeGroup = async (newerExtra: string[] = []) => {
    await project.write(older, olderText);
    await project.write(newer, newerText(newerExtra));
    await project.write(
      "stories/BACKLOG/ROW-78.md",
      storyText({ title: "Last", stage: "BACKLOG", createdAt: NOW.toISOString() }),
    );
  };

  it("gives the newer Story the next free number when each Story has factory state", async () => {
    await writeGroup(["worktree: /tmp/sidebar"]);
    await project.write("state.json", stateFile([attempt({ storyUid: OLDER_UID, stage: "DONE" }), attempt({})]));

    const result = await repair();

    expect(result.unrepaired).toEqual([]);
    expect(result.changes.map((change) => [change.from, change.to, change.previousPath, change.keptPath])).toEqual([
      ["ROW-77", "ROW-79", project.path(newer), project.path(older)],
    ]);
    expect(await project.read(older)).toBe(olderText);
    expect(await pathExists(project.path(newer))).toBe(false);
    expect((await getStory({ id: "ROW-77" }, project.ctx)).uid).toBe(OLDER_UID);
    expect((await getStory({ id: "ROW-79" }, project.ctx)).uid).toBe(NEWER_UID);
    expect((await getStory({ id: "ROW-79" }, project.ctx)).fields.worktree).toBe("/tmp/sidebar");
    expect(result.changes[0]?.stayed.attempts).toBe(1);
  });

  it("writes the worktree and the branch of the old ID, and the worker worktree service uses them", async () => {
    const root = project.paths.root;
    const worktree = defaultWorktreePath(root, "ROW-77");
    await git(root, "init");
    await git(root, "commit", "--allow-empty", "-m", "base");
    await git(root, "worktree", "add", "-b", "story/ROW-77", worktree);
    await writeGroup();

    const { changes } = await repair();
    const story = await getStory({ id: "ROW-79" }, project.ctx);

    expect(changes.map((change) => change.to)).toEqual(["ROW-79"]);
    expect(await project.read("stories/IN_DEVELOPMENT/ROW-79.md")).toContain(
      `worktree: ${worktree}\nbranch: story/ROW-77\n`,
    );
    expect(story.fields.worktree).toBe(worktree);
    expect(story.branch).toBe("story/ROW-77");
    expect(await prepareWorkerWorktree(root, story)).toEqual({ path: worktree, branch: "story/ROW-77" });
    // The Story that keeps the ID keeps the default values: it has a pull request and no `worktree`.
    expect(await project.read(older)).toBe(olderText);
  });

  it("writes no branch for a Story with a pull request, and no value that does not exist", async () => {
    const root = project.paths.root;
    await git(root, "init");
    await git(root, "commit", "--allow-empty", "-m", "base");
    await git(root, "branch", "story/ROW-77");
    await writeGroup(["pull_request: https://example.com/sidebar"]);

    await repair();

    const text = await project.read("stories/IN_DEVELOPMENT/ROW-79.md");
    expect(text).not.toContain("branch:");
    expect(text).not.toContain("worktree:");
  });

  it("lets an attempt and a Thread with the storyUid of the re-numbered Story find the new ID", async () => {
    const records = [attempt({ storyUid: NEWER_UID }), attempt({ storyUid: OLDER_UID, stage: "DONE" })];
    await writeGroup();
    await project.write("state.json", stateFile(records));
    const thread = await createThread(
      {
        role: "worker",
        storyId: "ROW-77",
        storyUid: NEWER_UID,
        stage: "IN_DEVELOPMENT",
        cwd: project.paths.root,
        ownerToken: "owner",
      },
      project.ctx,
    );

    await repair();

    const refs = await listStoryRefs(project.ctx);
    expect(records.map((record) => matchStoryRef(refs, attemptRef(record))?.id)).toEqual(["ROW-79", "ROW-77"]);
    expect((await listThreads({ story: "ROW-79" }, project.ctx)).threads.map((item) => item.id)).toEqual([thread.id]);
    expect((await listThreads({ story: "ROW-77" }, project.ctx)).threads).toEqual([]);
  });

  it("moves the attachment entries with the storyUid of the re-numbered Story, and the other entries stay", async () => {
    const moved = attachmentRecord("a11111111-1111-4111-8111-111111111111", "sidebar.png", NEWER_UID);
    const kept = attachmentRecord("a22222222-2222-4222-8222-222222222222", "tags.png", OLDER_UID);
    const old = attachmentRecord("a33333333-3333-4333-8333-333333333333", "old.png");
    await writeGroup();
    await project.write("attachments/ROW-77/manifest.json", JSON.stringify([moved, kept, old]));
    await Promise.all([moved, kept, old].map((record) => project.write(`attachments/ROW-77/${record.id}.png`, "png")));

    const { changes } = await repair();

    expect(changes.map((change) => [change.movedAttachments, change.stayed.attachments])).toEqual([
      [["sidebar.png"], ["old.png"]],
    ]);
    expect(JSON.parse(await project.read("attachments/ROW-79/manifest.json"))).toEqual([moved]);
    expect(await readdir(project.path("attachments/ROW-79"))).toEqual([`${moved.id}.png`, "manifest.json"]);
    expect(JSON.parse(await project.read("attachments/ROW-77/manifest.json"))).toEqual([kept, old]);
    expect((await readdir(project.path("attachments/ROW-77"))).toSorted()).toEqual(
      [`${kept.id}.png`, `${old.id}.png`, "manifest.json"].toSorted(),
    );
    expect((await getStory({ id: "ROW-79" }, project.ctx)).attachmentCount).toBe(1);
  });

  it("removes the old attachment folder when all its entries move", async () => {
    const moved = attachmentRecord("a11111111-1111-4111-8111-111111111111", "sidebar.png", NEWER_UID);
    await writeGroup();
    await project.write("attachments/ROW-77/manifest.json", JSON.stringify([moved]));
    await project.write(`attachments/ROW-77/${moved.id}.png`, "png");

    await repair();

    expect(await pathExists(project.path("attachments/ROW-77"))).toBe(false);
    expect(await project.read(`attachments/ROW-79/${moved.id}.png`)).toBe("png");
  });

  it.each([
    ["the Story ID", attempt({ status: "running" })],
    ["the storyUid", attempt({ story: "ROW-05", storyUid: NEWER_UID, status: "preparing" })],
  ])("does not repair the group while an attempt for %s runs", async (_name, running) => {
    await writeGroup();
    await project.write("state.json", stateFile([running]));

    const result = await repair();

    expect(result).toEqual({
      removed: [],
      changes: [],
      unrepaired: [
        {
          id: "ROW-77",
          paths: [project.path(older), project.path(newer)],
          reason: "A Story with this ID has a running attempt",
        },
      ],
    });
    expect(await project.read(newer)).toBe(newerText());
    expect(await readdir(project.path("stories/IN_DEVELOPMENT"))).toEqual(["ROW-77.md"]);
  });

  it("uses the ROW-81 rules for a group with a Story without uid", async () => {
    const olderWithoutUid = storyText({ title: "Tags", stage: "DONE", createdAt: "2026-01-01T00:00:00.000Z" });
    await project.write(older, olderWithoutUid);
    await project.write(newer, newerText(["worktree: /tmp/sidebar"]));

    const { changes } = await repair();

    // Only the newer Story has factory state, so the older Story gets the new number and no follow values.
    expect(changes.map((change) => [change.previousPath, change.to])).toEqual([[project.path(older), "ROW-78"]]);
    expect(await project.read(newer)).toBe(newerText(["worktree: /tmp/sidebar"]));
    expect(await project.read("stories/DONE/ROW-78.md")).not.toContain("branch:");
  });

  it("lists the dependsOn lists and Spec links that stay with the Story that keeps the ID", async () => {
    await writeGroup();
    await project.write(
      "stories/BACKLOG/ROW-80.md",
      "---\ntitle: Dependent\nstage: BACKLOG\ndependsOn:\n  - ROW-77\n---\n\nBody\n",
    );
    await project.write("specs/design.md", "---\ntitle: Design\nstories: [ROW-77]\n---\n\nBody\n");

    const { changes } = await repair();

    expect(changes.map((change) => [change.to, change.stayed])).toEqual([
      [
        "ROW-81",
        {
          dependents: [project.path("stories/BACKLOG/ROW-80.md")],
          specs: [project.path("specs/design.md")],
          attachments: [],
          attempts: 0,
        },
      ],
    ]);
    expect(await project.read("stories/BACKLOG/ROW-80.md")).toContain("  - ROW-77\n");
  });
});
