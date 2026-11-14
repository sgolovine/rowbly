import { cleanup } from "ink-testing-library";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UserPrompt } from "../../../../services/prompts/prompts.js";
import { renderTui } from "../../../testing/index.js";
import { PromptRow, promptState } from "./prompt-row.js";

afterEach(cleanup);

const prompt: UserPrompt = { name: "worker", label: "Worker", path: "/p/WORKER.md", exists: true, text: "Use pnpm." };

describe("PromptRow", () => {
  it("shows the label, the state and the agents that get the prompt", async () => {
    const tui = await renderTui(
      <PromptRow prompt={prompt} selected={true} idle={true} labelWidth={12} onClick={vi.fn()} />,
    );
    expect(tui.frame()).toMatch(/▌ Worker\s+1 line\s+All workers, in all Stages\./);
  });

  it("gives the state of the file", () => {
    expect(promptState({ ...prompt, exists: false, text: "" })).toBe("missing");
    expect(promptState({ ...prompt, text: "" })).toBe("empty");
    expect(promptState({ ...prompt, text: "one\ntwo\nthree" })).toBe("3 lines");
  });
});
