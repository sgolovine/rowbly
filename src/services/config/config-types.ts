export const CUSTOM_FIELD_TYPES = ["string", "number", "boolean", "url", "date", "select"] as const;
export type CustomFieldType = (typeof CUSTOM_FIELD_TYPES)[number];

export interface CustomField {
  /** The frontmatter key in every story. */
  key: string;
  label: string;
  type: CustomFieldType;
  /** The allowed values of a `select` field. */
  options?: string[];
}

export interface StageConfig {
  /** Also the stage's file name: `stages/<key>.md`. */
  key: string;
  label: string;
  enabled: boolean;
}

/** The shape of `.rowbly/rowbly.config.json`. */
export interface ProjectConfig {
  projectName: string;
  /** The prefix of every story ID: `ROW` in `ROW-01`. */
  projectKey: string;
  customFields: CustomField[];
  /** In board order. */
  stages: StageConfig[];
  /** The optional features that are on. A feature that is not here is off. */
  features?: FeatureConfig;
  /** The bundled skills that Rowbly installed in this project. */
  skills?: InstalledSkill[];
}

/** The optional features of a project, by name. */
export interface FeatureConfig {
  /** Markdown documents that are linked to Stories, in `specs/`. */
  specs?: boolean;
}

/** The names of the optional features. */
export const FEATURES = ["specs"] as const;
export type Feature = (typeof FEATURES)[number];

/** The coding harnesses that Rowbly can install a skill for. */
export const SKILL_HARNESSES = ["claude-code", "codex", "gemini-cli", "github-copilot", "cursor"] as const;
export type SkillHarness = (typeof SKILL_HARNESSES)[number];

/** A bundled skill and the harnesses it is installed for. */
export interface InstalledSkill {
  name: string;
  harnesses: SkillHarness[];
}

/** One problem in a config or an input, at the path of the field. */
export interface Issue {
  path: (string | number)[];
  message: string;
}
