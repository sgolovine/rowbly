import { Text } from "ink";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { Button } from "../../components/index.js";
import { factoryProblems, factoryState } from "../../screens/factory/index.js";
import { theme } from "../../theme.js";

const LABEL = "Factory";

/** The text after the label: the state in `ink-muted`, then `! n` in `stage-board` for problems. */
function noteParts(status: FactoryStatus | undefined, short: boolean): { state: string; problems: string } {
  const count = factoryProblems(status).length;
  return { state: factoryState(status, short), problems: count > 0 ? ` ! ${count}` : "" };
}

/**
 * The columns of the Button: its padding, the label, the note and, `withKey`, the gap and the key cap. `short`
 * leaves out the pending count.
 */
export function factoryButtonWidth(status: FactoryStatus | undefined, withKey: boolean, short = false): number {
  const { state, problems } = noteParts(status, short);
  return 1 + LABEL.length + 1 + state.length + problems.length + (withKey ? 4 : 0) + 1;
}

/**
 * The quiet header Button of the factory, with the key `f`: `Factory off`, `Factory 2/4 · 1 pending` or
 * `Factory 2/4 ! 1` when a running factory has problems. `short` leaves out the pending count, for a narrow
 * header. A click opens the Factory controls.
 */
export function FactoryButton({
  status,
  showKey,
  short = false,
  onClick,
  clickable,
}: {
  status: FactoryStatus | undefined;
  showKey: boolean;
  short?: boolean;
  onClick(): void;
  clickable: boolean;
}) {
  const { state, problems } = noteParts(status, short);
  return (
    <Button
      label={LABEL}
      note={
        <Text>
          <Text color={theme.inkMuted}>{state}</Text>
          {problems && <Text color={theme.stageBoard}>{problems}</Text>}
        </Text>
      }
      keyName={showKey ? "f" : undefined}
      onClick={onClick}
      clickable={clickable}
      compact
    />
  );
}
