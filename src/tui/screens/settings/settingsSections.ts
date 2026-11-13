import type { ComponentType } from "react";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { AiSection } from "./AiSection/index.js";
import { CustomFieldsSection } from "./CustomFieldsSection/index.js";
import { DoctorSection } from "./DoctorSection/index.js";
import { ProjectSection } from "./ProjectSection/index.js";
import { SkillsSection } from "./SkillsSection/index.js";
import { SpecsSection } from "./SpecsSection/index.js";
import { StagesSection } from "./StagesSection/index.js";

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
interface SettingsSection {
  id: string;
  label: string;
  /** One line about the contents, in the header band of the section. */
  description: string;
  Component: ComponentType<SettingsSectionProps>;
}

/** A heading in the section list and the sections under it. */
export interface SettingsGroup {
  title: string;
  sections: readonly SettingsSection[];
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
        id: "custom-fields",
        label: "Custom Fields",
        description: "The fields that every Story has.",
        Component: CustomFieldsSection,
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
    ],
  },
  {
    title: "Factory",
    sections: [
      {
        id: "ai",
        label: "AI",
        description: "AI providers, the models of the factory and the worker limit.",
        Component: AiSection,
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
