import { Box, Text, useInput } from "ink";
import { useRef, useState } from "react";
import { useIsActive, useKeyCapture } from "../../hooks/index.js";
import { Button } from "../button/index.js";
import { Modal } from "../modal/index.js";

const ESC_CANCEL = [{ key: "esc", description: "cancel" }];

export interface ConfirmDialogProps {
  /** The title of the popup, for example `Delete Story › ROW-01`. */
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Colours the confirm button red; use for deletions. */
  destructive?: boolean;
  onConfirm(): void;
  onCancel(): void;
  isActive?: boolean;
}

/**
 * The popup that asks before a destructive action, drawn over the area or Modal it is rendered in.
 * `y` or a click on the confirm button confirms, `n`, `esc` or a click on the cancel button cancels;
 * `enter` picks the focused button (cancel by default).
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel = "Yes",
  cancelLabel = "No",
  destructive = false,
  onConfirm,
  onCancel,
  isActive = true,
}: ConfirmDialogProps) {
  const active = useIsActive() && isActive;
  const [confirmFocused, setConfirmFocused] = useState(false);
  // The popup stays open while the work runs, so a double click must not start it twice.
  const confirmed = useRef(false);
  const confirm = () => {
    if (confirmed.current) return;
    confirmed.current = true;
    onConfirm();
  };
  useKeyCapture(active, { escape: true });

  useInput(
    (input, key) => {
      if (input === "y") confirm();
      else if (input === "n" || key.escape) onCancel();
      else if (key.leftArrow || key.rightArrow || key.tab || input === "h" || input === "l")
        setConfirmFocused((f) => !f);
      else if (key.return) (confirmFocused ? confirm : onCancel)();
    },
    { isActive: active },
  );

  return (
    <Modal title={title} size="dialog" hints={ESC_CANCEL}>
      <Box flexDirection="column" alignSelf="flex-start">
        <Text>{message}</Text>
        <Box marginTop={1} gap={2}>
          <Button
            label={confirmLabel}
            keyName="y"
            onClick={confirm}
            clickable={active}
            compact
            destructive={destructive}
            focused={confirmFocused}
          />
          <Button
            label={cancelLabel}
            keyName="n"
            onClick={onCancel}
            clickable={active}
            compact
            focused={!confirmFocused}
          />
        </Box>
      </Box>
    </Modal>
  );
}
