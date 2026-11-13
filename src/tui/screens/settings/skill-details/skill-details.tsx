import { Box, Text } from "ink";
import type { SkillStatus } from "../../../../services/skill/skill.js";
import { theme } from "../../../theme.js";

/** The props of `SkillDetails`. */
export interface SkillDetailsProps {
  readonly name: string;
  /** The copies that the Project tracks, if any. */
  readonly tracked: SkillStatus | undefined;
  /** False when the Rowbly package no longer has the skill. */
  readonly bundled: boolean;
}

/** The selected skill: each tracked harness with its state and its path. */
export function SkillDetails({ name, tracked, bundled }: SkillDetailsProps) {
  const installed = (tracked?.harnesses.length ?? 0) > 0;

  return (
    <Box flexDirection="column">
      <Text color={theme.ink} bold>
        {name}
      </Text>
      {!bundled && <Text color={theme.inkFaint}>No longer bundled. Install is unavailable.</Text>}
      {tracked?.harnesses.map((h) => (
        <Box key={h.harness} flexDirection="column">
          <Text color={theme.inkMuted}>
            {h.harness} · {h.installed ? "installed" : "missing"}
          </Text>
          <Text color={theme.inkFaint} wrap="wrap">
            {h.path}
          </Text>
        </Box>
      ))}
      {!installed && <Text color={theme.inkFaint}>Not installed.</Text>}
    </Box>
  );
}
