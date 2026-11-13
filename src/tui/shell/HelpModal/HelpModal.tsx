import { Box, Text, useInput } from "ink";
import { HelpOverlay, Modal } from "../../components/index.js";
import { useIsActive } from "../../hooks/index.js";
import { GLOBAL_KEYS, type KeyHint } from "../../keymap.js";
import { theme } from "../../theme.js";

/**
 * The keys of the region in focus, then the other keys of the shell, then what the `▶` of a Story row means.
 * `esc`, `?` and `q` close it.
 */
export function HelpModal({ hints, onClose }: { hints: readonly KeyHint[]; onClose(): void }) {
  useInput(
    (input, key) => {
      if (key.escape || input === "?" || input === "q") onClose();
    },
    { isActive: useIsActive() },
  );
  return (
    <Modal title="Keys" size="dialog" onClose={onClose}>
      <HelpOverlay hints={hints} globals={GLOBAL_KEYS} />
      <Box marginTop={1}>
        <Text color={theme.inkMuted}>
          <Text color={theme.accent}>▶</Text> shows a worker that the factory state (.rowbly/state.json) records for the
          Stage of the Story. Rowbly does not check that the worker is alive. ▶ conflict shows more than one recorded
          worker. ▶ unknown shows a record that is not complete. Factory in the header shows the factory of this
          Project: off, or the running workers and the worker limit. ! shows the number of problems.
        </Text>
      </Box>
    </Modal>
  );
}
