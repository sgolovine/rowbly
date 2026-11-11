import { Text } from "ink";
import type { FactoryActivity } from "../../../../services/factoryActivity/factoryActivity.js";
import { theme } from "../../../theme.js";

/**
 * One line about a problem with the factory state file, below the Story list. A missing file is a quiet
 * note. A file that Rowbly cannot use, or that is incomplete, is a warning with the path and the reason. A
 * valid file shows nothing.
 */
export function FactoryStatusLine({ activity }: { activity: FactoryActivity }) {
  if (activity.status === "ok") return null;
  if (activity.status === "missing") {
    return (
      <Text wrap="truncate-end" color={theme.inkFaint}>
        Factory activity: no .rowbly/state.json
      </Text>
    );
  }
  const problem = activity.status === "incomplete" ? "is incomplete" : "is unavailable";
  return (
    <Text wrap="truncate-end" color={theme.stageBoard}>
      ! Factory activity {problem}: {activity.path}: {activity.message}
    </Text>
  );
}
