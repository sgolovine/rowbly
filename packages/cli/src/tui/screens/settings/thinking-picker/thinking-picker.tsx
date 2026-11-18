import { Box, Text } from "ink";
import { SelectList } from "../../../components/index.js";
import { ActiveContext } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";

/** The props of `ThinkingPicker`. */
export interface ThinkingPickerProps {
  /** The id of the model: `provider/modelId`. */
  readonly modelId: string;
  readonly levels: readonly string[];
  /** The level that the role uses now. */
  readonly current: string | undefined;
  readonly active: boolean;
  /** Gets the chosen level, or `""` for the default of the model. */
  readonly onSelect: (level: string) => void;
}

/** The thinking levels of one model, after the model default. The level in use is selected first. */
export function ThinkingPicker({ modelId, levels, current, active, onSelect }: ThinkingPickerProps) {
  return (
    <Box flexDirection="column" gap={1}>
      <Text color={theme.inkMuted} wrap="truncate-end">
        The thinking levels of {modelId}
      </Text>
      <ActiveContext.Provider value={active}>
        <SelectList
          items={[{ value: "", label: "Model default" }, ...levels.map((level) => ({ value: level, label: level }))]}
          defaultIndex={Math.max(0, levels.indexOf(current ?? "") + 1)}
          onSelect={(item) => onSelect(item.value)}
        />
      </ActiveContext.Provider>
    </Box>
  );
}
