import { Box, Text } from "ink";
import type { PiCatalog } from "../../../../services/pi-catalog-cache/pi-catalog-cache.js";
import type { PiCatalogSource } from "../../../../services/pi-catalog-cache/pi-catalog-refresh.js";
import { piWorkerSource } from "../../../../services/pi-runtime/pi-worker-client.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, Loading, Modal } from "../../../components/index.js";
import type { AsyncState } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { ModelPickerModal } from "../model-picker-modal/index.js";
import { openPicker, saveSetupModel, setupHints, skipSetup } from "./setup-actions.js";
import { useSetup } from "./use-setup.js";

const TITLE = "Set up › Worker model";

/** The props of `WorkerModelSetup`. */
export interface WorkerModelSetupProps {
  readonly ctx: ServiceContext;
  readonly onClose: () => void;
  /** Closes the setup and opens the AI section of Settings. */
  readonly onAiSettings: () => void;
  /** Reads the models from Pi. The default is the Pi worker. */
  readonly source?: PiCatalogSource;
}

/** The line under the text: the models load, no provider is signed in, or the read failed. */
function ModelsState({ catalog, signedIn }: { catalog: AsyncState<PiCatalog>; signedIn: boolean | undefined }) {
  if (catalog.loading) {
    return <Loading label="Loading models…" />;
  }

  if (signedIn === undefined) {
    return (
      <Text color={theme.inkMuted} wrap="wrap">
        Rowbly cannot read the models of Pi. Press a to open Settings › AI.
      </Text>
    );
  }

  if (!signedIn) {
    return (
      <Text color={theme.inkMuted} wrap="wrap">
        No AI provider is signed in. Press a to sign in under Settings › AI.
      </Text>
    );
  }

  return null;
}

/**
 * The setup Modal that shows when a Project without a worker model opens. `w` selects the model, `a` opens the AI
 * settings, and `esc` closes the Modal for now. The board works without a model, but the factory does not start.
 */
export function WorkerModelSetup({ ctx, onClose, onAiSettings, source = piWorkerSource() }: WorkerModelSetupProps) {
  const { env, catalog, signedIn, picking, active } = useSetup({ ctx, source, onClose, onAiSettings });

  if (picking && catalog.data) {
    return (
      <ModelPickerModal
        title={TITLE}
        models={catalog.data.models}
        clearable={false}
        onSave={(choice) => saveSetupModel(env, choice)}
        onClose={() => env.setPicking(false)}
      />
    );
  }

  return (
    <Modal title={TITLE} hints={setupHints(env.ready)} onClose={() => skipSetup(env)}>
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="column">
          <Text color={theme.ink} wrap="wrap">
            This Project has no worker model. Each worker of the factory uses it for the work of one Story.
          </Text>
          <Text color={theme.inkMuted} wrap="wrap">
            Rowbly does not start the factory until you select one. The board works without it.
          </Text>
        </Box>
        <ModelsState catalog={catalog} signedIn={signedIn} />
        <Box flexWrap="wrap" gap={1}>
          {env.ready && (
            <Button
              label="Select model"
              keyName="w"
              primary
              compact
              clickable={active}
              onClick={() => openPicker(env)}
            />
          )}
          <Button label="AI settings" keyName="a" compact clickable={active} onClick={onAiSettings} />
          <Button label="Later" keyName="esc" compact clickable={active} onClick={() => skipSetup(env)} />
        </Box>
      </Box>
    </Modal>
  );
}
