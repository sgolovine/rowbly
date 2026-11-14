import { describe, expect, it } from "vitest";
import { ValidationError } from "../errors/errors.js";
import { updateProject } from "../project/project.js";
import { createStage } from "../stage/stage.js";
import { useTestProject } from "../test-project/test-project.js";
import {
  checkFieldKey,
  checkFieldOptions,
  checkProjectKey,
  checkStageKey,
  configIssues,
  featureEnabled,
  isSkillName,
  labelFromKey,
  type ProjectConfig,
  parseConfig,
  readConfig,
  throwIfIssues,
  toFieldKey,
  toProjectKey,
  toStageKey,
  writeConfig,
} from "./config.js";

const VALID: ProjectConfig = {
  projectName: "Rowbly",
  projectKey: "ROW",
  customFields: [{ key: "priority", label: "Priority", type: "select", options: ["low", "high"] }],
  stages: [{ key: "BACKLOG", label: "Backlog", enabled: true }],
};

describe("key checks", () => {
  it("checkProjectKey accepts uppercase letters and digits", () => {
    expect(checkProjectKey("ROW2")).toEqual([]);
    expect(checkProjectKey("row")).toHaveLength(1);
    expect(checkProjectKey("2ROW", ["key"])[0]?.path).toEqual(["key"]);
  });

  it("checkStageKey accepts UPPER_SNAKE_CASE", () => {
    expect(checkStageKey("IN_PROGRESS")).toEqual([]);
    expect(checkStageKey("in progress")).toHaveLength(1);
    expect(checkStageKey("_X")).toHaveLength(1);
  });

  it("checkFieldKey accepts snake_case and rejects reserved keys", () => {
    expect(checkFieldKey("due_date")).toEqual([]);
    expect(checkFieldKey("DueDate")).toHaveLength(1);
    expect(checkFieldKey("title")[0]?.message).toMatch(/reserved/);
  });
});

describe("checkFieldOptions", () => {
  it("rejects options on a field that is not select", () => {
    expect(checkFieldOptions("string", undefined, ["options"])).toEqual([]);
    expect(checkFieldOptions("string", ["a"], ["options"])).toHaveLength(1);
  });

  it("requires unique, non-empty options for select", () => {
    expect(checkFieldOptions("select", ["a", "b"], ["options"])).toEqual([]);
    expect(checkFieldOptions("select", undefined, ["options"])).toHaveLength(1);
    expect(checkFieldOptions("select", [], ["options"])).toHaveLength(1);
    expect(checkFieldOptions("select", ["a", "a"], ["options"])[0]?.message).toMatch(/unique/);
    expect(checkFieldOptions("select", ["a", " "], ["options"])[0]?.message).toMatch(/empty/);
  });
});

describe("key conversion", () => {
  it("toStageKey", () => {
    expect(toStageKey(" In Progress! ")).toBe("IN_PROGRESS");
    expect(toStageKey("2 Review")).toBe("REVIEW");
  });

  it("toFieldKey", () => {
    expect(toFieldKey("Due Date")).toBe("due_date");
  });

  it("toProjectKey", () => {
    expect(toProjectKey("My Cool Project")).toBe("MYC");
    expect(toProjectKey("Rowbly")).toBe("ROW");
    expect(toProjectKey("3d-app")).toBe("DAP");
    expect(toProjectKey("ab")).toBe("AB");
    expect(toProjectKey("123")).toBe("ROW");
  });

  it("labelFromKey", () => {
    expect(labelFromKey("IN_PROGRESS")).toBe("In Progress");
    expect(labelFromKey("__DONE")).toBe("Done");
  });
});

describe("throwIfIssues", () => {
  it("does nothing without issues", () => {
    expect(() => throwIfIssues("bad", [])).not.toThrow();
  });

  it("throws a ValidationError that carries the issues and the hint", () => {
    const issues = [{ path: ["name"], message: "Name is required" }];
    try {
      throwIfIssues("bad", issues, "hint");
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(ValidationError);
      expect((error as ValidationError).details.issues).toEqual(issues);
      expect((error as ValidationError).hint).toBe("hint");
    }
  });
});

describe("configIssues", () => {
  it("accepts a valid config", () => {
    expect(configIssues(VALID)).toEqual([]);
  });

  it("rejects a value that is not an object", () => {
    expect(configIssues([])).toEqual([{ path: [], message: "The config must be a JSON object" }]);
  });

  it("reports missing top-level keys", () => {
    const paths = configIssues({}).map((issue) => issue.path.join("."));
    expect(paths).toEqual(["projectName", "projectKey", "customFields", "stages"]);
  });

  it("reports bad custom fields", () => {
    const issues = configIssues({
      ...VALID,
      customFields: [
        "x",
        { key: "a", label: "A", type: "string" },
        { key: "a", label: "", type: "nope" },
        { key: "b", label: "B", type: "select", options: [1] },
      ],
    });
    expect(issues.map((issue) => issue.path.join("."))).toEqual([
      "customFields.0",
      "customFields.2.key",
      "customFields.2.label",
      "customFields.2.type",
      "customFields.3.options",
    ]);
  });

  it("reports bad stages", () => {
    expect(configIssues({ ...VALID, stages: [] })[0]?.message).toMatch(/at least one stage/);
    const issues = configIssues({
      ...VALID,
      stages: [null, { key: "A", label: "A", enabled: true }, { key: "A", label: " ", enabled: "yes" }],
    });
    expect(issues.map((issue) => issue.path.join("."))).toEqual([
      "stages.0",
      "stages.2.key",
      "stages.2.label",
      "stages.2.enabled",
    ]);
  });
});

describe("skills in the config", () => {
  const issuesOf = (skills: unknown) => configIssues({ ...VALID, skills });

  it("accepts a config with no skills and a config with valid skills", () => {
    expect(configIssues(VALID)).toEqual([]);
    expect(issuesOf([{ name: "develop", harnesses: ["claude-code", "codex"] }])).toEqual([]);
  });

  it("isSkillName accepts lowercase words that hyphens separate", () => {
    expect(isSkillName("code-review-2")).toBe(true);
    for (const name of ["", "A", "a--b", "-a", "a-", "a_b", "a/b", "../x", "a".repeat(65)]) {
      expect(isSkillName(name)).toBe(false);
    }
    expect(isSkillName("a".repeat(64))).toBe(true);
  });

  it("rejects skills that are not an array, and entries that are not objects", () => {
    expect(issuesOf({})).toEqual([{ path: ["skills"], message: "skills must be an array" }]);
    expect(issuesOf(["x"])).toEqual([{ path: ["skills", 0], message: "A skill must be an object" }]);
  });

  it("rejects a name that is missing, a path or repeated", () => {
    expect(issuesOf([{ harnesses: ["codex"] }])).toEqual([
      { path: ["skills", 0, "name"], message: "name is required" },
    ]);
    expect(issuesOf([{ name: "../x", harnesses: ["codex"] }])[0]?.path).toEqual(["skills", 0, "name"]);
    expect(
      issuesOf([
        { name: "a", harnesses: ["codex"] },
        { name: "a", harnesses: ["cursor"] },
      ]),
    ).toEqual([{ path: ["skills", 1, "name"], message: 'Duplicate skill "a"' }]);
  });

  it("rejects harnesses that are not a list, empty, unknown or repeated", () => {
    expect(issuesOf([{ name: "a" }])).toEqual([
      { path: ["skills", 0, "harnesses"], message: "harnesses must be an array" },
    ]);
    expect(issuesOf([{ name: "a", harnesses: [] }])).toEqual([
      { path: ["skills", 0, "harnesses"], message: "A skill needs at least one harness" },
    ]);
    expect(issuesOf([{ name: "a", harnesses: ["vim", "codex", "codex"] }])).toEqual([
      { path: ["skills", 0, "harnesses", 0], message: 'Unknown harness "vim"' },
      { path: ["skills", 0, "harnesses", 2], message: 'Duplicate harness "codex"' },
    ]);
  });
});

describe("parseConfig", () => {
  it("reports invalid JSON as an issue", () => {
    const result = parseConfig("{");
    expect(result.config).toBeUndefined();
    expect(result.issues[0]?.message).toMatch(/not valid JSON/);
  });

  it("reads the features, and reports an unknown feature or a value that is not a boolean", () => {
    const text = JSON.stringify({ ...VALID, features: { specs: true } });
    expect(parseConfig(text).config?.features).toEqual({ specs: true });
    expect(featureEnabled(VALID, "specs")).toBe(false);
    expect(configIssues({ ...VALID, features: { specs: "yes", epics: true } })).toEqual([
      { path: ["features", "specs"], message: "specs must be true or false" },
      { path: ["features", "epics"], message: 'Unknown feature "epics"' },
    ]);
  });

  it("keeps a factory object, and reports a factory value that is not an object", () => {
    const factory = { maxWorkers: 2, git: { push: true } };
    expect(parseConfig(JSON.stringify({ ...VALID, factory })).config?.factory).toEqual(factory);
    expect(configIssues({ ...VALID, factory: { maxWorkers: "bad" } })).toEqual([]);
    for (const bad of [5, "x", null, [1]]) {
      expect(configIssues({ ...VALID, factory: bad })).toEqual([
        { path: ["factory"], message: "factory must be an object" },
      ]);
    }
  });

  it("drops unknown keys", () => {
    const text = JSON.stringify({ ...VALID, extra: 1, stages: [{ ...VALID.stages[0], color: "red" }] });
    expect(parseConfig(text)).toEqual({ config: VALID, issues: [] });
  });
});

describe("readConfig and writeConfig", () => {
  const project = useTestProject();

  it("writes and reads back the config", async () => {
    await writeConfig(project.paths, VALID);
    expect(await readConfig(project.paths)).toEqual(VALID);
    expect(await project.read("rowbly.config.json")).toBe(`${JSON.stringify(VALID, null, 2)}\n`);
  });

  it("omits the skills key when a config has no skills", async () => {
    await writeConfig(project.paths, VALID);
    expect(await project.read("rowbly.config.json")).not.toContain("skills");
  });

  it("keeps the skills when other services write the config", async () => {
    const skills: ProjectConfig["skills"] = [{ name: "develop", harnesses: ["cursor", "codex"] }];
    await writeConfig(project.paths, { ...(await readConfig(project.paths)), skills });
    await updateProject({ name: "Renamed" }, project.ctx);
    await createStage({ label: "Review" }, project.ctx);
    expect((await readConfig(project.paths)).skills).toEqual(skills);
  });

  it("keeps the factory section as the last key when other services write the config", async () => {
    const factory = { maxWorkers: 3 };
    await writeConfig(project.paths, { ...(await readConfig(project.paths)), factory });
    await updateProject({ name: "Renamed" }, project.ctx);
    await createStage({ label: "Review" }, project.ctx);
    const raw = JSON.parse(await project.read("rowbly.config.json"));
    expect(raw.factory).toEqual(factory);
    expect(Object.keys(raw).at(-1)).toBe("factory");
  });

  it("throws a ValidationError for an invalid file", async () => {
    await project.write("rowbly.config.json", "{}");
    await expect(readConfig(project.paths)).rejects.toBeInstanceOf(ValidationError);
  });
});
