import { Box, type Key, Text, useInput } from "ink";
import { type Dispatch, type RefObject, type SetStateAction, useRef, useState } from "react";
import { useIsActive, useKeyCapture, writeRef } from "../../hooks/index.js";
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

interface ConfirmEnv {
  readonly confirmFocused: boolean;
  readonly setConfirmFocused: Dispatch<SetStateAction<boolean>>;
  readonly confirm: () => void;
  readonly onCancel: () => void;
}

/** Confirms one time. The popup stays open while the work runs, so a double click must not start it twice. */
function confirmOnce(confirmed: RefObject<boolean>, onConfirm: () => void): void {
  if (confirmed.current) {
    return;
  }

  writeRef(confirmed, true);
  onConfirm();
}

function handleConfirmKey(env: ConfirmEnv, input: string, key: Key): void {
  if (input === "y") {
    env.confirm();

    return;
  }

  if (input === "n" || key.escape) {
    env.onCancel();

    return;
  }

  if (key.leftArrow || key.rightArrow || key.tab || input === "h" || input === "l") {
    env.setConfirmFocused((focused) => !focused);

    return;
  }

  if (key.return) {
    (env.confirmFocused ? env.confirm : env.onCancel)();
  }
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
  const confirmed = useRef(false);

  const actions = { confirm: () => confirmOnce(confirmed, onConfirm) };
  const env: ConfirmEnv = { confirmFocused, setConfirmFocused, confirm: actions.confirm, onCancel };

  useKeyCapture(active, { escape: true });
  useInput((input, key) => handleConfirmKey(env, input, key), { isActive: active });

  return (
    <Modal title={title} size="dialog" hints={ESC_CANCEL}>
      <Box flexDirection="column" alignSelf="flex-start">
        <Text>{message}</Text>
        <Box marginTop={1} gap={2}>
          <Button
            label={confirmLabel}
            keyName="y"
            onClick={actions.confirm}
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
