import { Box, Text } from "ink";
import { checkLimits } from "../../../../services/factory-settings/check-settings.js";
import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { Button } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { AiSettingCard } from "../ai-setting-card/index.js";
import { CheckList } from "../check-list/index.js";

/** The props of `AiChecksPage`. */
export interface AiChecksPageProps {
  readonly settings: FactorySettings | undefined;
  /** False while a task on top has the keys. */
  readonly idle: boolean;
  /** The index of the highlighted check. */
  readonly cursor: number;
  readonly onLimits: () => void;
  readonly onAdd: () => void;
  readonly onCheck: (index: number) => void;
}

/** The text of the check limits: the number at the same time and the memory that stays free. */
export function checkLimitsText(settings: FactorySettings | undefined): string {
  if (!settings) {
    return "—";
  }

  const limits = checkLimits(settings.checks ?? {});
  const count = limits?.maxConcurrent === 1 ? "1 check" : `${limits?.maxConcurrent} checks`;

  return `${count} at the same time · keep ${limits?.reserveMemoryMb} MB free`;
}

/**
 * The Checks tab: the check limits in a card, then one row for each check that the factory runs for its workers.
 * Without checks, the workers run their checks in the shell, as before.
 */
export function AiChecksPage({ settings, idle, cursor, onLimits, onAdd, onCheck }: AiChecksPageProps) {
  const checks = checkLimits(settings?.checks)?.items ?? [];

  return (
    <Box flexDirection="column">
      <AiSettingCard
        title="Check limits"
        value={checkLimitsText(settings)}
        description="The factory starts a check only when a slot is free and the free memory covers the estimate of the check."
        action={settings ? "Edit" : undefined}
        keyName="c"
        clickable={idle}
        onEdit={onLimits}
      />
      <Box flexDirection="column" marginTop={1} paddingX={1}>
        <Box justifyContent="space-between" gap={1}>
          <Text bold color={theme.ink}>
            Checks
          </Text>
          <Button label="Add check" keyName="n" compact clickable={idle} onClick={onAdd} />
        </Box>
        <Text color={theme.inkFaint} wrap="wrap">
          Workers run these checks only with run_check, through the queue of the factory.
        </Text>
        <Box marginTop={1}>
          {checks.length > 0 ? (
            <CheckList checks={checks} cursor={cursor} active={idle} onPick={onCheck} />
          ) : (
            <Text color={theme.inkFaint}>No checks. The workers run their checks in the shell.</Text>
          )}
        </Box>
      </Box>
    </Box>
  );
}
