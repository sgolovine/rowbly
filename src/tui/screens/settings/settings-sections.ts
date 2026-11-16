import type { ComponentType } from "react";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { AiSection } from "./ai-section/index.js";
import { CustomFieldsSection } from "./custom-fields-section/index.js";
import { DisplaySection } from "./display-section/index.js";
import { DoctorSection } from "./doctor-section/index.js";
import { GitSection } from "./git-section/index.js";
import { HostsSection } from "./hosts-section/index.js";
import { ProjectSection } from "./project-section/index.js";
import { PromptsSection } from "./prompts-section/index.js";
import { SkillsSection } from "./skills-section/index.js";
import { SpecsSection } from "./specs-section/index.js";
import { StagesSection } from "./stages-section/index.js";
import { TagsSection } from "./tags-section/index.js";

/** What the Settings Modal gives to each section. */
export interface SettingsSectionProps {
  ctx: ServiceContext;
  /** Call after the section changes the project, so that the screens behind Settings read it again. */
  onChange(): void;
}

/**
 * One entry in the section list of Settings. The section reads `useIsActive()` for its focus and declares
 * its keys with `useKeyHints`. The Settings Modal shows them in its hint strip.
 */
export interface SettingsSection {
  readonly id: string;
  readonly label: string;
  /** One line about the contents, in the header band of the section. */
  readonly description: string;
  readonly Component: ComponentType<SettingsSectionProps>;
}

/** A heading in the section list and the sections under it. */
export interface SettingsGroup {
  readonly title: string;
  readonly sections: readonly SettingsSection[];
}

/** Every settings section, in the order of the section list. To add a setting, add a section here. */
export const SETTINGS_GROUPS: readonly SettingsGroup[] = [
  {
    title: "Project",
    sections: [
      {
        id: "project",
        label: "General",
        description: "The name and the key of the project.",
        Component: ProjectSection,
      },
      {
        id: "stages",
        label: "Stages",
        description: "The Stages of the board, in board order.",
        Component: StagesSection,
      },
      {
        id: "prompts",
        label: "Prompts",
        description: "The prompts of the factory agents, in .rowbly/prompts/.",
        Component: PromptsSection,
      },
      {
        id: "custom-fields",
        label: "Custom Fields",
        description: "The fields that every Story has.",
        Component: CustomFieldsSection,
      },
      {
        id: "tags",
        label: "Tags",
        description: "The tags that a Story can have.",
        Component: TagsSection,
      },
      {
        id: "skills",
        label: "Skills",
        description: "Manage bundled skills and the harnesses that use them.",
        Component: SkillsSection,
      },
      {
        id: "specs",
        label: "Specs",
        description: "Markdown documents that are linked to Stories.",
        Component: SpecsSection,
      },
      {
        id: "display",
        label: "Display",
        description: "How the screens show the data of the project.",
        Component: DisplaySection,
      },
    ],
  },
  {
    title: "Factory",
    sections: [
      {
        id: "ai",
        label: "AI",
        description: "AI providers, the models of the factory, the worker limit and the checks.",
        Component: AiSection,
      },
      {
        id: "git",
        label: "Git",
        description: "The commits of the canonical checkout and its periodic sync.",
        Component: GitSection,
      },
      {
        id: "hosts",
        label: "Hosts",
        description: "The worker hosts and the placement of new workers.",
        Component: HostsSection,
      },
    ],
  },
  {
    title: "Maintenance",
    sections: [
      {
        id: "doctor",
        label: "Doctor",
        description: "Compares the files in .rowbly/ with the config.",
        Component: DoctorSection,
      },
    ],
  },
];
