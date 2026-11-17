import { Box } from "ink";
import { Button } from "../../../components/index.js";

/** The props of `FactoryButtons`. */
export interface FactoryButtonsProps {
  readonly live: boolean;
  /** The factory can start only with a way to start its process. */
  readonly canLaunch: boolean;
  readonly stopping: boolean;
  readonly busy: "start" | "stop" | null;
  readonly canStart: boolean;
  readonly canStop: boolean;
  /** The live factory has warnings. */
  readonly canWarnings?: boolean;
  /** The live factory has a warning that can be dismissed, and no dismiss runs. */
  readonly canDismissAll?: boolean;
  /** False while a dialog or a different view has the keys; then the buttons do not take a click. */
  readonly idle: boolean;
  readonly onStart: () => void;
  readonly onHistory: () => void;
  readonly onWarnings?: () => void;
  readonly onDismissAll?: () => void;
  readonly onStop: () => void;
  readonly onAiSettings?: () => void;
}

/** The buttons of the Factory controls. Each button has the key that the Modal shows in its hints. */
export function FactoryButtons(props: FactoryButtonsProps) {
  const { live, canLaunch, stopping, busy, canStart, canStop, idle } = props;

  return (
    <Box flexWrap="wrap" gap={1}>
      {!live && canLaunch && (
        <Button
          label={busy === "start" ? "Start…" : "Start"}
          keyName="s"
          busy={busy === "start"}
          compact
          clickable={idle && canStart}
          onClick={props.onStart}
        />
      )}
      {props.canWarnings && props.onWarnings && (
        <Button label="Warnings" keyName="w" compact clickable={idle} onClick={props.onWarnings} />
      )}
      {props.canDismissAll && props.onDismissAll && (
        <Button label="Dismiss all" keyName="d" compact clickable={idle} onClick={props.onDismissAll} />
      )}
      <Button label="History" keyName="h" compact clickable={idle} onClick={props.onHistory} />
      {props.onAiSettings && (
        <Button label="AI settings" keyName="a" compact clickable={idle} onClick={props.onAiSettings} />
      )}
      {live && (
        <Button
          label={busy === "stop" || stopping ? "Stop…" : "Stop"}
          keyName="x"
          busy={!canStop}
          destructive={canStop}
          compact
          clickable={idle && canStop}
          onClick={props.onStop}
        />
      )}
    </Box>
  );
}
