import { Text } from "ink";
import type { FactoryActivity } from "../../../../services/factory-activity/factory-activity.js";
import { theme } from "../../../theme.js";

/**
 * One line about a problem with the factory state file, below the Story list. A file that Rowbly cannot use,
 * or that is incomplete, is a warning with the path and the reason. A valid file shows nothing, and so does a
 * missing file: a Project without a factory run has none, and the header shows the state of the factory.
 */
export function FactoryStatusLine({ activity }: { activity: FactoryActivity }) {
  if (activity.status === "ok" || activity.status === "missing") {
    return null;
  }
  const problem = activity.status === "incomplete" ? "is incomplete" : "is unavailable";
  return (
    <Text wrap="truncate-end" color={theme.stageBoard}>
      ! Factory activity {problem}: {activity.path}: {activity.message}
    </Text>
  );
}
