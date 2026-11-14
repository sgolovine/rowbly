import { Box } from "ink";
import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { AiSettingCard } from "../ai-setting-card/index.js";

/** The props of `AiLimitsPage`. */
export interface AiLimitsPageProps {
  readonly settings: FactorySettings | undefined;
  /** False while a task on top has the keys. */
  readonly idle: boolean;
  readonly onLimit: () => void;
}

function workersText(settings: FactorySettings | undefined): string {
  if (!settings) {
    return "—";
  }

  return settings.maxWorkers === 1 ? "1 worker" : `${settings.maxWorkers} workers`;
}

/** The Limits tab: each limit of the factory in its own card, with the Button and the key that edit it. */
export function AiLimitsPage({ settings, idle, onLimit }: AiLimitsPageProps) {
  return (
    <Box flexDirection="column">
      <AiSettingCard
        title="Worker limit"
        value={workersText(settings)}
        description="The maximum number of workers that the factory runs at the same time."
        action="Edit"
        keyName="l"
        clickable={idle}
        onEdit={onLimit}
      />
    </Box>
  );
}
