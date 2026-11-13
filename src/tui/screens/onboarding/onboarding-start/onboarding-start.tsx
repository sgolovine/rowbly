import { Box, Text } from "ink";
import { SelectList } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { useStepHints } from "../use-step-hints.js";

const HINTS: readonly KeyHint[] = [
  { key: "↑/↓", description: "select" },
  { key: "enter", description: "choose" },
];

/** The first step of onboarding: the defaults, or a choice for each step. */
export function OnboardingStart({
  onChoose,
  onHints,
}: {
  onChoose(mode: "defaults" | "customize"): void;
  onHints(hints: readonly KeyHint[]): void;
}) {
  useStepHints(onHints, HINTS);
  return (
    <Box flexDirection="column">
      <Text bold color={theme.ink}>
        No Rowbly project in this directory.
      </Text>
      <Text color={theme.inkFaint}>Set up a project here. You can change all of it later.</Text>
      <Box marginTop={1}>
        <SelectList<"defaults" | "customize">
          items={[
            { value: "defaults", label: "Use defaults", description: "go to the summary" },
            { value: "customize", label: "Customize", description: "choose the name, Stages and skills" },
          ]}
          onSelect={(item) => onChoose(item.value)}
        />
      </Box>
    </Box>
  );
}
