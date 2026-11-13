import { readdir } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as storyService from "../../services/story/story.js";
import { getStory } from "../../services/story/story.js";
import { useTempDir, useTestProject } from "../../services/testProject/testProject.js";
import { createProgram, runCli } from "../testCli/testCli.js";

const resources = {
  project: ["update", "get-instructions"],
  story: ["create", "update", "delete", "get", "search"],
  stage: ["create", "update", "delete", "get"],
  "custom-field": ["add", "update", "remove"],
  spec: ["create", "update", "delete", "get", "list", "link", "unlink"],
  skill: ["install", "list", "remove"],
  thread: ["list", "show"],
};

describe("registerCommands", () => {
  const outside = useTempDir();
  const project = useTestProject();

  afterEach(() => {
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it.each(["get", "delete"])("rejects extra story %s arguments before it calls the service", async (action) => {
    const first = await storyService.createStory({ title: "First" }, project.ctx);
    const second = await storyService.createStory({ title: "Second" }, project.ctx);
    const service = vi.spyOn(storyService, action === "get" ? "getStory" : "deleteStory");

    const result = await runCli(["--json", "story", action, first.id, second.id], project.paths.root);

    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("too many arguments");
    expect(result.stdout).toBe("");
    expect(service).not.toHaveBeenCalled();
    expect(await storyService.searchStories({}, project.ctx)).toEqual([first, second]);
  });

  it.each([
    ["project", "update", "--name", "Example"],
    ["story", "create", "--title", "Example"],
    ["stage", "get", "BACKLOG"],
    ["custom-field", "remove", "priority"],
    ["spec", "link", "example", "ROW-01"],
    ["skill", "list"],
  ])("rejects extra arguments for %s %s", async (...args) => {
    const result = await runCli([...args, "extra"], outside.path);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("too many arguments");
    expect(result.stdout).toBe("");
  });

  it("registers only the resource groups and standalone commands", async () => {
    const program = createProgram();
    expect(program.commands.map((command) => command.name())).toEqual([
      "add-attachment",
      "list-attachments",
      "open-attachment",
      "remove-attachment",
      "init",
      "project",
      "doctor",
      "story",
      "stage",
      "custom-field",
      "spec",
      "skill",
      "thread",
    ]);
    for (const [resource, actions] of Object.entries(resources)) {
      expect(
        program.commands.find((command) => command.name() === resource)?.commands.map((action) => action.name()),
      ).toEqual(actions);
    }
    const result = await runCli(["--help"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("--json");
    expect(result.stdout).toContain("-C, --cwd <dir>");
    for (const name of ["init", "doctor", ...Object.keys(resources)]) expect(result.stdout).toContain(name);
    expect(result.stdout).not.toContain("create-story");
  });

  for (const [resource, actions] of Object.entries(resources)) {
    for (const flags of [[], ["-h"], ["--help"]]) {
      it(`prints ${resource} help outside a Project with ${flags.join(" ") || "no action"}`, async () => {
        const before = await readdir(outside.path);
        const result = await runCli([resource, ...flags], outside.path);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`Usage: rowbly ${resource}`);
        for (const action of actions) expect(result.stdout).toContain(action);
        expect(await readdir(outside.path)).toEqual(before);
      });
    }

    for (const action of actions) {
      it(`prints help for ${resource} ${action} without a Project`, async () => {
        const command = createProgram()
          .commands.find((command) => command.name() === resource)
          ?.commands.find((command) => command.name() === action);
        const result = await runCli([resource, action, "--help"], outside.path);
        expect(result.exitCode).toBe(0);
        expect(result.stderr).toBe("");
        expect(result.stdout).toContain(`Usage: rowbly ${resource} ${action}`);
        for (const option of command?.options ?? []) expect(result.stdout).toContain(option.flags);
        for (const argument of command?.registeredArguments ?? []) expect(result.stdout).toContain(argument.name());
      });
    }

    it(`rejects an unknown ${resource} action`, async () => {
      const result = await runCli([resource, "nope", "extra"], outside.path);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain("unknown command 'nope'");
    });
  }

  it.each(["before", "between", "after"])("accepts global options %s the resource and action", async (placement) => {
    const globals = ["--json", "-C", project.paths.root];
    const args =
      placement === "before"
        ? [...globals, "story", "create", "--title", "Example"]
        : placement === "between"
          ? ["story", ...globals, "create", "--title", "Example"]
          : ["story", "create", "--title", "Example", ...globals];
    const result = await runCli(args);
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    const story = JSON.parse(result.stdout);
    expect(story).toMatchObject({ id: "ROW-01", title: "Example", stage: "BACKLOG", fields: {} });
    expect(await getStory({ id: story.id }, project.ctx)).toEqual(story);
  });

  it.each(["create-story", "update-project", "get-instructions", "nope"])(
    "rejects the root command %s",
    async (name) => {
      const result = await runCli([name], outside.path);
      expect(result.exitCode).not.toBe(0);
      expect(result.stderr).toContain(`unknown command '${name}'`);
    },
  );
});
