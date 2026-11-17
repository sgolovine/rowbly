import { Text } from "ink";
import type { FactoryStatus } from "../../../services/factory/factory.js";
import { Button } from "../../components/index.js";
import { connectivityWord, factoryProblems, factoryState } from "../../screens/factory/factory-status.js";
import { theme } from "../../theme.js";

const LABEL = "Factory";

/** The colour of each connectivity word. The other states use `ink-muted`. */
const CONNECTIVITY_COLORS = { offline: theme.danger, degraded: theme.stageBoard } as const;

/** The token of the state: `danger` for `offline`, `stage-board` for `degraded`, else `ink-muted`. */
function stateColor(status: FactoryStatus | undefined): string {
  const connectivity = connectivityWord(status);

  return connectivity ? CONNECTIVITY_COLORS[connectivity] : theme.inkMuted;
}

/**
 * The text after the label: the state, then `! n` in `stage-board` for problems. The state is in `ink-muted`, or in
 * the colour of its connectivity word.
 */
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
 * The quiet header Button of the factory, with the key `f`: `Factory off`, `Factory 2/4 · 1 pending`,
 * `Factory 2/4 ! 1` when a running factory has problems, or `Factory offline` and `Factory degraded` when its
 * providers have network pauses. `short` leaves out the pending count, for a narrow
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
          <Text color={stateColor(status)}>{state}</Text>
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
