import { Text } from "ink";
import type { KnownProject } from "../../../services/known-project/known-project.js";
import { theme } from "../../theme.js";

interface ProjectTagProps {
  readonly project: KnownProject;
  /** The root of the open Project. */
  readonly current: string | undefined;
}

/** The tag after the name of a Project in the switcher: `current`, `missing` or nothing. */
export function ProjectTag({ project, current }: ProjectTagProps) {
  if (project.path === current) {
    return <Text color={theme.accent}> · current</Text>;
  }

  return project.missing ? <Text color={theme.danger}> · missing</Text> : null;
}
