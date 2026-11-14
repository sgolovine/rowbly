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
  readonly canInspect: boolean;
  /** The live factory has warnings. */
  readonly canWarnings?: boolean;
  /** False while a dialog or a different view has the keys; then the buttons do not take a click. */
  readonly idle: boolean;
  readonly onStart: () => void;
  readonly onInspect: () => void;
  readonly onHistory: () => void;
  readonly onWarnings?: () => void;
  readonly onStop: () => void;
  readonly onAiSettings?: () => void;
}

/** The buttons of the Factory controls. Each button has the key that the Modal shows in its hints. */
export function FactoryButtons(props: FactoryButtonsProps) {
  const { live, canLaunch, stopping, busy, canStart, canStop, canInspect, idle } = props;

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
      {canInspect && <Button label="Supervisor" keyName="enter" compact clickable={idle} onClick={props.onInspect} />}
      {props.canWarnings && props.onWarnings && (
        <Button label="Warnings" keyName="w" compact clickable={idle} onClick={props.onWarnings} />
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
