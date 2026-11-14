import { rm } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { readSystemPrompt } from "../prompts/prompts.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  composeMessage,
  runSection,
  supervisorMessage,
  USER_PROMPT_LIMIT,
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

    expect(workerSystemPrompt(text, false)).toBe("A\nB");
    expect(workerSystemPrompt(text, true)).toBe("A\nUse run_check.\nB");
    expect(await readSystemPrompt("worker")).toContain("<!-- checks -->");
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
    expect(message).toContain(workerSystemPrompt(await readSystemPrompt("worker"), false));
    expect(message).not.toContain("run_check");
    expect(message).toContain("# Project prompt\n\nUse pnpm.");
    expect(message).toContain("# Worker prompt\n\nWrite small commits.");
    expect(message).toContain("Story: WEB-42");
    expect(message).not.toContain("Not for workers.");
    expect(message).not.toContain(await readSystemPrompt("supervisor"));
  });

  it("gives the supervisor its prompts and the digest, with no Stage prompt", async () => {
    await project.write("prompts/SUPERVISOR.md", "Start one worker.\n");
    await project.write("prompts/WORKER.md", "Not for the supervisor.\n");

    const message = await supervisorMessage(project.paths, "Digest text.");

    expect(headings(message)).toEqual([
      "# Rowbly system prompt",
      "# Rowbly supervisor system prompt",
      "# Supervisor prompt",
      "# Digest",
    ]);
    expect(message).toContain("# Supervisor prompt\n\nStart one worker.");
    expect(message).toMatch(/# Digest\n\nDigest text\.$/);
    expect(message).not.toContain("Not for the supervisor.");
  });

  it("gives a worker the check rules when the Project has checks", async () => {
    const message = await workerMessage(project.paths, {
      ...run,
      checks: [{ key: "test", label: "Tests", narrow: false }],
    });

    expect(message).toContain("Run each listed check only with the `run_check` tool.");
    expect(message).not.toContain("<!-- checks -->");
  });

  it("works when the project has no user prompts", async () => {
    await rm(project.paths.promptsDir, { recursive: true });

    const message = await workerMessage(project.paths, { ...run, stagePrompt: "" });

    expect(headings(message)).toEqual(["# Rowbly system prompt", "# Rowbly worker system prompt", "# Run"]);
  });

  it("cuts a long user prompt", async () => {
    await project.write("prompts/SYSTEM.md", "x".repeat(USER_PROMPT_LIMIT + 50));

    const message = await supervisorMessage(project.paths, "Digest text.");

    expect(message).toContain(`# Project prompt\n\n${"x".repeat(USER_PROMPT_LIMIT)}\n\n# Digest`);
  });
});
