import { Box, Text } from "ink";
import type { KeyHint } from "../../keymap.js";
import { theme } from "../../theme.js";
import { Button } from "../button/index.js";
import { fitHints, hintsWidth } from "../fit-hints.js";
import { KeyHints } from "../key-hints/index.js";

const CLOSE = "Close";
// The Close Button's width: its padding, label, gap and `esc` key cap.
const CLOSE_WIDTH = 1 + CLOSE.length + 1 + " esc ".length + 1;

export interface ModalFooterProps {
  readonly hints: readonly KeyHint[];
  /** An info modal: a Close Button that calls this replaces the hint strip. */
  readonly onClose?: () => void;
  /** The modal is the top layer. Under another layer, the strip goes quiet. */
  readonly top: boolean;
  /** The width of the modal. */
  readonly width: number;
}

/**
 * The bottom row of a `ModalFrame`: the hint strip, or the Close Button of an info modal. Under another
 * layer, the strip or the Close Button keeps its line and its width, so the frame does not move or resize.
 */
export function ModalFooter({ hints, onClose, top, width }: ModalFooterProps) {
  const blank = onClose ? CLOSE_WIDTH : Math.max(1, hintsWidth(fitHints(hints, width - 6)));
  const live = onClose ? (
    <Button label={CLOSE} keyName="esc" onClick={onClose} clickable compact />
  ) : (
    <KeyHints hints={hints} width={width - 6} />
  );

  return (
    <Box
      // The Close Button pads its own label, so it lines up with the body text.
      paddingX={onClose ? 1 : 2}
      flexShrink={0}
      borderStyle="single"
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      borderColor={theme.border}
    >
      {top ? live : <Text>{" ".repeat(blank)}</Text>}
    </Box>
  );
}
