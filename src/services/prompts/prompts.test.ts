import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { NotFoundError } from "../errors/errors.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  createUserPrompts,
  getPrompt,
  listPrompts,
  PROMPT_NAMES,
  readSystemPrompt,
  readUserPrompt,
  setPrompt,
  systemPromptPath,
  userPromptPath,
} from "./prompts.js";

describe("prompts", () => {
  const project = useTestProject();

  it("a new project has an empty file for each user prompt", async () => {
    const prompts = await listPrompts(project.ctx);

    expect(prompts.map((prompt) => [prompt.name, prompt.exists, prompt.text])).toEqual([
      ["system", true, ""],
      ["supervisor", true, ""],
      ["worker", true, ""],
    ]);
    expect(prompts[0]?.path).toBe(join(project.paths.promptsDir, "SYSTEM.md"));
  });

  it("a missing user prompt has no text", async () => {
    await rm(project.paths.promptsDir, { recursive: true });

    expect(await readUserPrompt(project.paths, "worker")).toEqual({
      name: "worker",
      label: "Worker",
      path: userPromptPath(project.paths, "worker"),
      exists: false,
      text: "",
    });
  });

  it("setPrompt writes the trimmed text with a final newline", async () => {
    await setPrompt({ name: "supervisor", text: "  Start one worker.  \n\n" }, project.ctx);

    expect(await readFile(userPromptPath(project.paths, "supervisor"), "utf8")).toBe("Start one worker.\n");
    expect((await getPrompt("supervisor", project.ctx)).text).toBe("Start one worker.");
  });

  it("setPrompt with no text gives an empty file", async () => {
    await setPrompt({ name: "system", text: "Old text." }, project.ctx);
    await setPrompt({ name: "system", text: "   " }, project.ctx);

    expect(await readFile(userPromptPath(project.paths, "system"), "utf8")).toBe("");
  });

  it("rejects an unknown prompt name", async () => {
    await expect(getPrompt("stage", project.ctx)).rejects.toBeInstanceOf(NotFoundError);
    await expect(setPrompt({ name: "ROWBLY", text: "x" }, project.ctx)).rejects.toBeInstanceOf(NotFoundError);
  });

  it("createUserPrompts keeps the text of existing prompts", async () => {
    await project.write("prompts/WORKER.md", "Use pnpm.\n");
    await rm(userPromptPath(project.paths, "system"));
    await createUserPrompts(project.paths);

    expect((await readUserPrompt(project.paths, "worker")).text).toBe("Use pnpm.");
    expect((await readUserPrompt(project.paths, "system")).exists).toBe(true);
  });

  it("the Rowbly package has a system prompt for each name", async () => {
    for (const name of PROMPT_NAMES) {
      expect(await systemPromptPath(name)).toMatch(/src\/config\/prompts\/[A-Z]+\.md$/);
      expect((await readSystemPrompt(name)).length).toBeGreaterThan(0);
    }
  });
});
