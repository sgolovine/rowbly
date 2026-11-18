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
  checkTagValue,
  checkTimeZone,
  compactThreads,
  configIssues,
  featureEnabled,
  isSkillName,
  isTimeZone,
  labelFromKey,
  type ProjectConfig,
  parseConfig,
  projectTags,
  readConfig,
  storySidebarBehavior,
  storyTimeZone,
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
    expect(checkFieldKey("tags")[0]?.message).toMatch(/reserved/);
    expect(checkFieldKey("uid")[0]?.message).toMatch(/reserved/);
  });

  it("checkTagValue accepts lowercase letters, digits, _ and -, starting with a letter or a digit", () => {
    expect(checkTagValue("frontend")).toEqual([]);
    expect(checkTagValue("2nd_try-a")).toEqual([]);
    expect(checkTagValue("Front")).toHaveLength(1);
    expect(checkTagValue("-x")).toHaveLength(1);
    expect(checkTagValue("a b")).toHaveLength(1);
    expect(checkTagValue("", ["tags", 0, "value"])[0]?.path).toEqual(["tags", 0, "value"]);
  });
});

describe("tags in the config", () => {
  it("accepts a config without tags, and it has no tags", () => {
    expect(configIssues(VALID)).toEqual([]);
    expect(projectTags(VALID)).toEqual([]);
  });

  it("accepts valid tags and keeps them in order", () => {
    const tags = [
      { value: "frontend", label: "Front end" },
      { value: "backend", label: "Back end" },
    ];
    const text = JSON.stringify({ ...VALID, tags: tags.map((tag) => ({ ...tag, color: "red" })) });
    const { config, issues } = parseConfig(text);
    expect(issues).toEqual([]);
    expect(config?.tags).toEqual(tags);
    expect(projectTags(config as ProjectConfig)).toEqual(tags);
  });

  it("reports tags that are not a list", () => {
    expect(configIssues({ ...VALID, tags: {} })).toEqual([{ path: ["tags"], message: "tags must be an array" }]);
  });

  it("reports a tag with no value, no label, a bad value or a duplicate value", () => {
    const issues = configIssues({
      ...VALID,
      tags: [
        "x",
        { label: "No value" },
        { value: "nolabel" },
        { value: "Bad Value", label: "Bad" },
        { value: "docs", label: "Docs" },
        { value: "docs", label: "Docs again" },
      ],
    });
    expect(issues).toEqual([
      { path: ["tags", 0], message: "A tag must be an object" },
      { path: ["tags", 1, "value"], message: "value is required" },
      { path: ["tags", 2, "label"], message: "label is required" },
      { path: ["tags", 3, "value"], message: expect.stringContaining('Tag value "Bad Value"') },
      { path: ["tags", 5, "value"], message: 'Duplicate tag value "docs"' },
    ]);
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

  it("accepts a stage with or without expandedByDefault, and reports a value that is not a boolean", () => {
    const stage = { key: "A", label: "A", enabled: true };
    expect(configIssues({ ...VALID, stages: [stage] })).toEqual([]);
    expect(configIssues({ ...VALID, stages: [{ ...stage, expandedByDefault: false }] })).toEqual([]);
    expect(configIssues({ ...VALID, stages: [{ ...stage, expandedByDefault: true }] })).toEqual([]);
    for (const bad of ["no", 0, null, {}]) {
      expect(configIssues({ ...VALID, stages: [stage, { ...stage, key: "B", expandedByDefault: bad }] })).toEqual([
        { path: ["stages", 1, "expandedByDefault"], message: "expandedByDefault must be true or false" },
      ]);
    }
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

  it("reads the display options, and the compact Thread mode is on when it is not set", () => {
    const text = JSON.stringify({ ...VALID, display: { compactThreads: false } });
    const config = parseConfig(text).config as ProjectConfig;
    expect(config.display).toEqual({ compactThreads: false });
    expect(compactThreads(config)).toBe(false);
    expect(compactThreads({ ...VALID, display: { compactThreads: true } })).toBe(true);
    expect(compactThreads(VALID)).toBe(true);
    expect(compactThreads({ ...VALID, display: {} })).toBe(true);
    expect(configIssues(VALID)).toEqual([]);
  });

  it("reads the Story sidebar option, which is regular when it is not set", () => {
    expect(storySidebarBehavior(VALID)).toBe("regular");
    expect(storySidebarBehavior({ ...VALID, display: {} })).toBe("regular");
    for (const value of ["regular", "expanded", "remember"] as const) {
      const { config, issues } = parseConfig(JSON.stringify({ ...VALID, display: { storySidebar: value } }));
      expect(issues).toEqual([]);
      expect(config && storySidebarBehavior(config)).toBe(value);
    }
  });

  it("reports a Story sidebar option that is not one of the 3 values", () => {
    for (const bad of ["wide", true, 1, null]) {
      expect(configIssues({ ...VALID, display: { storySidebar: bad } })).toEqual([
        { path: ["display", "storySidebar"], message: "storySidebar must be one of: regular, expanded, remember" },
      ]);
    }
  });

  it("reports a display value that is not an object, an unknown option or a value that is not a boolean", () => {
    for (const bad of [5, "x", null, [1]]) {
      expect(configIssues({ ...VALID, display: bad })).toEqual([
        { path: ["display"], message: "display must be an object" },
      ]);
    }
    expect(configIssues({ ...VALID, display: { compactThreads: "yes", wide: true } })).toEqual([
      { path: ["display", "compactThreads"], message: "compactThreads must be true or false" },
      { path: ["display", "wide"], message: 'Unknown display option "wide"' },
    ]);
  });

  it("reads a valid time zone, and reports a time zone that Intl does not accept", () => {
    const text = JSON.stringify({ ...VALID, display: { timeZone: "Europe/Berlin" } });
    const { config } = parseConfig(text) as { config: ProjectConfig };
    expect(config.display).toEqual({ timeZone: "Europe/Berlin" });
    expect(storyTimeZone(config)).toBe("Europe/Berlin");
    expect(storyTimeZone(VALID)).toBeUndefined();
    expect(configIssues({ ...VALID, display: { timeZone: "Mars/Olympus" } })).toEqual([
      { path: ["display", "timeZone"], message: 'Unknown time zone "Mars/Olympus"' },
    ]);
    expect(configIssues({ ...VALID, display: { timeZone: 5 } })).toEqual([
      { path: ["display", "timeZone"], message: "timeZone must be a time zone name" },
    ]);
    expect(configIssues({ ...VALID, display: { timeZone: "" } })).toHaveLength(1);
  });

  it("isTimeZone accepts the names of Intl.DateTimeFormat only", () => {
    expect(isTimeZone("UTC")).toBe(true);
    expect(isTimeZone("America/New_York")).toBe(true);
    expect(isTimeZone("")).toBe(false);
    expect(isTimeZone("Nowhere/City")).toBe(false);
    expect(checkTimeZone("UTC")).toEqual([]);
    expect(checkTimeZone("x", ["timeZone"])).toEqual([{ path: ["timeZone"], message: 'Unknown time zone "x"' }]);
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

  it("writes the tags after the custom fields, and omits the key when a config has no tags", async () => {
    await writeConfig(project.paths, VALID);
    expect(await project.read("rowbly.config.json")).not.toContain("tags");
    await writeConfig(project.paths, { ...VALID, tags: [{ value: "docs", label: "Docs" }] });
    expect(Object.keys(JSON.parse(await project.read("rowbly.config.json")))).toEqual([
      "projectName",
      "projectKey",
      "customFields",
      "tags",
      "stages",
    ]);
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

  it("writes and reads back the display options", async () => {
    const config: ProjectConfig = { ...VALID, display: { compactThreads: false } };
    await writeConfig(project.paths, config);
    expect(await readConfig(project.paths)).toEqual(config);
    expect(JSON.parse(await project.read("rowbly.config.json")).display).toEqual({ compactThreads: false });
  });

  it("keeps expandedByDefault when it is set, and does not add it when it is not set", async () => {
    const config: ProjectConfig = {
      ...VALID,
      stages: [
        { key: "BACKLOG", label: "Backlog", enabled: true, expandedByDefault: false },
        { key: "DONE", label: "Done", enabled: true, expandedByDefault: true },
        { key: "LATER", label: "Later", enabled: false },
      ],
    };
    await writeConfig(project.paths, config);
    expect(await readConfig(project.paths)).toEqual(config);
    const raw = JSON.parse(await project.read("rowbly.config.json"));
    expect(raw.stages[0].expandedByDefault).toBe(false);
    expect(raw.stages[1].expandedByDefault).toBe(true);
    expect("expandedByDefault" in raw.stages[2]).toBe(false);
    expect(parseConfig(JSON.stringify(config)).config).toEqual(config);
  });

  it("throws a ValidationError for an invalid file", async () => {
    await project.write("rowbly.config.json", "{}");
    await expect(readConfig(project.paths)).rejects.toBeInstanceOf(ValidationError);
  });
});
