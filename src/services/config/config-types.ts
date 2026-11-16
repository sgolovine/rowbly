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

/** A tag that a Story can have. The value is the identifier and cannot change. */
export interface TagConfig {
  /** The identifier in the `tags` list of each Story. */
  value: string;
  /** The display name. */
  label: string;
}

export interface StageConfig {
  /** Also the stage's file name: `stages/<key>.md`. */
  key: string;
  label: string;
  enabled: boolean;
  /** Tells if the TUI shows the section of the Stage expanded when a Project opens. A value that is not set is `true`. */
  expandedByDefault?: boolean;
}

/** The shape of `.rowbly/rowbly.config.json`. */
export interface ProjectConfig {
  projectName: string;
  /** The prefix of every story ID: `ROW` in `ROW-01`. */
  projectKey: string;
  customFields: CustomField[];
  /** The tags that a Story can have. A config without the key has no tags. */
  tags?: TagConfig[];
  /** In board order. */
  stages: StageConfig[];
  /** The optional features that are on. A feature that is not here is off. */
  features?: FeatureConfig;
  /** The bundled skills that Rowbly installed in this project. */
  skills?: InstalledSkill[];
  /** The settings of the native factory. The factory-settings service checks the keys. */
  factory?: Record<string, unknown>;
  /** The display options of the TUI. */
  display?: DisplayConfig;
}

/** The display options of the TUI for a project. */
export interface DisplayConfig {
  /** Shows each Thread on one line. A value that is not set is `true`. */
  compactThreads?: boolean;
  /** The IANA time zone of the Story times, for example `Europe/Berlin`. A value that is not set is the system zone. */
  timeZone?: string;
  /** The width of the Story sidebar when it opens. A value that is not set is `regular`. */
  storySidebar?: StorySidebarBehavior;
}

/**
 * How the Story sidebar opens: at the regular width, expanded over the Story list, or in the last state that the
 * user selected while the TUI runs.
 */
export type StorySidebarBehavior = "regular" | "expanded" | "remember";

/** The values of the `storySidebar` display option, in the order of the Settings. */
export const STORY_SIDEBAR_BEHAVIORS: readonly StorySidebarBehavior[] = ["regular", "expanded", "remember"];

/** The names of the display options. */
export const DISPLAY_OPTIONS = ["compactThreads", "timeZone", "storySidebar"] as const;
export type DisplayOption = (typeof DISPLAY_OPTIONS)[number];

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
