import { useInput } from "ink";
import { HelpOverlay, Modal } from "../../components/index.js";
import { useIsActive } from "../../hooks/index.js";
import { GLOBAL_KEYS, type KeyHint } from "../../keymap.js";

/** The keys of the region in focus, then the other keys of the shell. `esc`, `?` and `q` close it. */
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
    </Modal>
  );
}
