import { Text } from "ink";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { Button } from "../../components/index.js";
import { checksCount } from "../../screens/factory/index.js";
import { theme } from "../../theme.js";

const LABEL = "Checks";

type Checks = NonNullable<FactoryStatus["checks"]>;

/** The columns of the Button: its padding, the label, the note and, `withKey`, the gap and the key cap. */
export function checksButtonWidth(checks: Checks, withKey: boolean): number {
  return 1 + LABEL.length + 1 + checksCount(checks).length + (withKey ? 4 : 0) + 1;
}

/**
 * The quiet header Button of the check queue, with the key `c`: `Checks 2/1` shows the running and the queued
 * checks of the live factory. A click opens the Checks Modal.
 */
export function ChecksButton({
  checks,
  showKey,
  onClick,
  clickable,
}: {
  checks: Checks;
  showKey: boolean;
  onClick(): void;
  clickable: boolean;
}) {
  return (
    <Button
      label={LABEL}
      note={<Text color={theme.inkMuted}>{checksCount(checks)}</Text>}
      keyName={showKey ? "c" : undefined}
      onClick={onClick}
      clickable={clickable}
      compact
    />
  );
}
