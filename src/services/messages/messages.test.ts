import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readSystemPrompt } from "../prompts/prompts.js";
import type { Story } from "../story/story.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  composeMessage,
  runSection,
  steeringMessage,
  USER_PROMPT_LIMIT,
  upstreamOf,
  workerMessage,
  workerSystemPrompt,
} from "./messages.js";

const run = {
  story: "WEB-42",
  stage: "IN_DEVELOPMENT",
  stagePrompt: "Develop the Story.",
  root: "/repo",
  worktree: "/repo/.worktrees/web-42",
  model: "anthropic/claude-opus-5-5",
  shim: "/repo/.rowbly/runtime/bin/rowbly",
  lock: "/tmp/rowbly's lock",
};

/** The `#` headings of a message, in order. */
function headings(message: string): string[] {
  return message.split("\n").filter((line) => /^# (Rowbly|Project|Supervisor|Worker|Stage|Run|Digest)/.test(line));
}

describe("composeMessage", () => {
  it("puts each section under a heading and leaves out the sections with no text", () => {
    expect(
      composeMessage([
        { title: "One", text: " first \n" },
        { title: "Empty", text: "  " },
        { title: "Two", text: "second" },
      ]),
    ).toBe("# One\n\nfirst\n\n# Two\n\nsecond");
  });
});

describe("runSection", () => {
  it("quotes the paths of the Project write command for the shell", () => {
    expect(runSection(run)).toContain(
      "Command prefix: `flock -w 60 '/tmp/rowbly'\\''s lock' '/repo/.rowbly/runtime/bin/rowbly' -C '/repo' --json`",
    );
  });
});

describe("a remote worker", () => {
  it("gives the copy, the worktree of the host and the write.lock and shim of the host, without checks", () => {
    const agent = "/home/u/.local/share/rowbly/projects/web-0123456789ab/agent";
    const text = runSection({
      ...run,
      root: `${agent}/threads/t1/copy`,
      worktree: "/home/u/repo-worktrees/WEB-42",
      shim: `${agent}/bin/rowbly`,
      lock: `${agent}/threads/t1/write.lock`,
      checks: [],
    });

    expect(text).toContain(`Canonical Project root: \`${agent}/threads/t1/copy\``);
    expect(text).toContain("Worktree: `/home/u/repo-worktrees/WEB-42`");
    expect(text).toContain(
      `Command prefix: \`flock -w 60 '${agent}/threads/t1/write.lock' '${agent}/bin/rowbly' -C '${agent}/threads/t1/copy' --json\``,
    );
    expect(text).not.toContain("Checks");
  });
});

describe("checks", () => {
  it("lists the checks in the Run section only when the Project has checks", () => {
    expect(runSection(run)).not.toContain("Checks");
    expect(
      runSection({
        ...run,
        checks: [
          { key: "test", label: "Tests", narrow: true },
          { key: "lint", label: "lint", narrow: false },
        ],
      }),
    ).toContain(
      "Checks (run each one only with `run_check`):\n- `test`: Tests (narrow form with files)\n- `lint`: lint",
    );
  });

  it("keeps the check rules of the worker system prompt only with checks", async () => {
    const text = "A\n<!-- checks -->\nUse run_check.\n<!-- /checks -->\nB";

    expect(workerSystemPrompt(text, { checks: false, upstream: false })).toBe("A\nB");
    expect(workerSystemPrompt(text, { checks: true, upstream: false })).toBe("A\nUse run_check.\nB");
    expect(await readSystemPrompt("worker")).toContain("<!-- checks -->");
  });
});

function story(id: string, overrides: Partial<Story> = {}): Story {
  return {
    id,
    number: Number(id.split("-")[1]),
    title: `Title of ${id}`,
    stage: "DONE",
    position: 1,
    dependsOn: [],
    tags: [],
    createdAt: null,
    updatedAt: null,
    description: "",
    fields: {},
    path: `/repo/.rowbly/stories/${id}.md`,
    ...overrides,
  };
}

const UPSTREAM_RULE = "The upstream Stories are complete.";

describe("upstream Stories", () => {
  const stories = [
    story("WEB-07", { title: "Second", stage: "IN_REVIEW", fields: { pull_request: null, priority: "P1" } }),
    story("WEB-03", {
      title: "First",
      fields: { pull_request: "https://github.com/o/r/pull/3", design: "", priority: "P2" },
    }),
  ];

  it("maps dependsOn to upstream Stories in order, with the url fields that have a value", () => {
    const current = story("WEB-42", { dependsOn: ["WEB-03", "WEB-07"] });

    expect(upstreamOf(current, stories, ["pull_request", "design"])).toEqual([
      {
        id: "WEB-03",
        title: "First",
        stage: "DONE",
        links: [{ key: "pull_request", value: "https://github.com/o/r/pull/3" }],
      },
      { id: "WEB-07", title: "Second", stage: "IN_REVIEW", links: [] },
    ]);
  });

  it("skips an upstream ID that does not exist, without an error", () => {
    const current = story("WEB-42", { dependsOn: ["WEB-99", "WEB-07"] });

    expect(upstreamOf(current, stories, ["pull_request"]).map((s) => s.id)).toEqual(["WEB-07"]);
    expect(upstreamOf(story("WEB-42", { dependsOn: ["WEB-99"] }), stories, [])).toEqual([]);
  });

  it("lists the upstream Stories in the Run section in dependsOn order", () => {
    const current = story("WEB-42", { dependsOn: ["WEB-07", "WEB-03"] });
    const section = runSection({ ...run, upstream: upstreamOf(current, stories, ["pull_request", "design"]) });

    expect(section).toContain(
      [
        "Upstream Stories (read each one with `story get`):",
        "- WEB-07: Second (IN_REVIEW)",
        "- WEB-03: First (DONE), pull_request: https://github.com/o/r/pull/3",
      ].join("\n"),
    );
    expect(section).not.toContain("priority");
    expect(section).not.toContain("design");
  });

  it("keeps the upstream rule of the worker system prompt only with upstream Stories", async () => {
    const text = "A\n<!-- upstream -->\nRead them.\n<!-- /upstream -->\nB";

    expect(workerSystemPrompt(text, { checks: false, upstream: false })).toBe("A\nB");
    expect(workerSystemPrompt(text, { checks: false, upstream: true })).toBe("A\nRead them.\nB");
    expect(await readSystemPrompt("worker")).toContain("<!-- upstream -->");
  });
});

describe("factory messages", () => {
  const project = useTestProject();

  it("gives a worker the system prompts, the user prompts, the Stage prompt and the run, in this order", async () => {
    await project.write("prompts/SYSTEM.md", "Use pnpm.\n");
    await project.write("prompts/WORKER.md", "Write small commits.\n");
    await project.write("prompts/SUPERVISOR.md", "Not for workers.\n");

    const message = await workerMessage(project.paths, run);

    expect(headings(message)).toEqual([
      "# Rowbly system prompt",
      "# Rowbly worker system prompt",
      "# Project prompt",
      "# Worker prompt",
      "# Stage prompt (IN_DEVELOPMENT)",
      "# Run",
    ]);
    expect(message).toContain(workerSystemPrompt(await readSystemPrompt("worker"), { checks: false, upstream: false }));
    expect(message).not.toContain("run_check");
    expect(message).toContain("# Project prompt\n\nUse pnpm.");
    expect(message).toContain("# Worker prompt\n\nWrite small commits.");
    expect(message).toContain("Story: WEB-42");
    expect(message).not.toContain("Not for workers.");
    expect(message).not.toContain(await readSystemPrompt("supervisor"));
  });

  it("gives a worker the check rules when the Project has checks", async () => {
    const message = await workerMessage(project.paths, {
      ...run,
      checks: [{ key: "test", label: "Tests", narrow: false }],
    });

    expect(message).toContain("Run each listed check only with the `run_check` tool.");
    expect(message).not.toContain("<!-- checks -->");
  });

  it("gives a worker the upstream Stories and the upstream rule when the Story has dependencies", async () => {
    const message = await workerMessage(project.paths, {
      ...run,
      upstream: [{ id: "WEB-03", title: "First", stage: "DONE", links: [] }],
    });

    expect(message).toContain(UPSTREAM_RULE);
    expect(message).toContain("Do not do their work again.");
    expect(message).toContain("- WEB-03: First (DONE)");
    expect(message).not.toContain("<!-- upstream -->");
    expect(message).not.toContain("<!-- /upstream -->");
  });

  it("gives a worker without dependencies the same message as before upstream Stories", async () => {
    const message = await workerMessage(project.paths, { ...run, upstream: [] });
    const legacy = (await readSystemPrompt("worker")).replace(/<!-- checks -->[\s\S]*?<!-- \/upstream -->\n/, "");

    expect(message).toBe(await workerMessage(project.paths, run));
    expect(message).toContain(`# Rowbly worker system prompt\n\n${legacy.trim()}`);
    expect(message).not.toContain(UPSTREAM_RULE);
    expect(message).not.toContain("Upstream Stories");
    expect(message).not.toContain("upstream -->");
  });

  it("works when the project has no user prompts", async () => {
    await rm(project.paths.promptsDir, { recursive: true });

    const message = await workerMessage(project.paths, { ...run, stagePrompt: "" });

    expect(headings(message)).toEqual(["# Rowbly system prompt", "# Rowbly worker system prompt", "# Run"]);
  });

  it("cuts a long user prompt", async () => {
    await project.write("prompts/SYSTEM.md", "x".repeat(USER_PROMPT_LIMIT + 50));

    const message = await workerMessage(project.paths, run);

    expect(message).toContain(`# Project prompt\n\n${"x".repeat(USER_PROMPT_LIMIT)}\n\n# Stage prompt`);
  });
});

describe("steeringMessage", () => {
  it("puts a note that a person wrote the text above the trimmed text", () => {
    const message = steeringMessage("  Use the new API.\n");

    expect(message.startsWith("# Message from the user\n\nA person sent this message to you")).toBe(true);
    expect(message.endsWith("\n\nUse the new API.")).toBe(true);
  });
});
