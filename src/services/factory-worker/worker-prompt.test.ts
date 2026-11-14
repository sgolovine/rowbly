import { expect, it } from "vitest";
import { workerPrompt } from "./worker-prompt.js";

const input = {
  story: "WEB-42",
  stage: "IN_DEVELOPMENT",
  root: "/repo",
  worktree: "/repo/.worktrees/web-42",
  model: "anthropic/claude-opus-5-5",
  skill: "/repo/.agents/skills/develop/SKILL.md",
  projectInstructions: "Use pnpm.",
  stagePrompt: "Develop the Story.",
  shim: "/repo/.rowbly/runtime/bin/rowbly",
  lock: "/tmp/rowbly's lock",
};

it("puts each input into the worker prompt", () => {
  const text = workerPrompt(input);

  expect(text).toMatch(/^Work on Story WEB-42 in Stage IN_DEVELOPMENT\.\n/);
  expect(text).toContain("Your worktree is `/repo/.worktrees/web-42`. Your model is anthropic/claude-opus-5-5.");
  expect(text).toContain("Read the work skill at `/repo/.agents/skills/develop/SKILL.md`.");
  expect(text).toContain("Project instructions:\nUse pnpm.\n\nStage prompt:\nDevelop the Story.\n");
  expect(text).toMatch(/end with `RESULT: <outcome>`\.$/);
});

it("quotes the paths of the Project write command for the shell", () => {
  expect(workerPrompt(input)).toContain(
    "`flock -w 60 '/tmp/rowbly'\\''s lock' '/repo/.rowbly/runtime/bin/rowbly' -C '/repo' --json`",
  );
});
