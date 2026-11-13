import { Box } from "ink";
import { Button } from "../../../components/index.js";
import type { Role } from "../ai-view.js";

/** The props of `AiButtons`. */
export interface AiButtonsProps {
  readonly canSignIn: boolean;
  readonly canSignOut: boolean;
  /** True when Pi and the providers have loaded, so that the models can change. */
  readonly ready: boolean;
  /** False while a task on top has the keys; then the buttons do not take a click. */
  readonly idle: boolean;
  readonly onSignIn: () => void;
  readonly onSignOut: () => void;
  readonly onModel: (role: Role) => void;
  readonly onLimit: () => void;
  readonly onReload: () => void;
}

/** The buttons of the AI settings. Each button has the key that the hints show. */
export function AiButtons({ canSignIn, canSignOut, ready, idle, ...on }: AiButtonsProps) {
  return (
    <Box flexWrap="wrap" gap={1}>
      {canSignIn && <Button label="Sign in" keyName="enter" compact clickable={idle} onClick={on.onSignIn} />}
      {canSignOut && (
        <Button label="Sign out" keyName="d" compact destructive clickable={idle} onClick={on.onSignOut} />
      )}
      {ready && (
        <>
          <Button
            label="Supervisor model"
            keyName="s"
            compact
            clickable={idle}
            onClick={() => on.onModel("supervisor")}
          />
          <Button label="Worker model" keyName="w" compact clickable={idle} onClick={() => on.onModel("worker")} />
        </>
      )}
      <Button label="Worker limit" keyName="l" compact clickable={idle} onClick={on.onLimit} />
      <Button label="Reload" keyName="r" compact clickable={idle} onClick={on.onReload} />
    </Box>
  );
}
