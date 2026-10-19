import { useInput } from 'ink';
import { useState } from 'react';
import { useIsActive, useKeyCapture, useLayout } from '../hooks';
import { Modal, modalSize } from './Modal';
import { TextArea } from './TextArea';

export interface TextAreaModalProps {
  /** Shown in the top edge of the border. */
  title: string;
  /** The text when it opens; from then on the modal holds the text and reports every change. */
  initial: string;
  onChange(value: string): void;
  onClose(): void;
}

/** Rows shown when the modal grows with its content (tests, piped output) rather than filling the terminal. */
const UNBOUNDED_ROWS = 10;

const HINTS = [{ key: 'esc/ctrl+f', description: 'close' }];

/**
 * A `TextArea`'s text in a modal as large as the area it covers. `esc`, `ctrl+f` and the `✕` in its
 * border close it; every edit has already gone to `onChange`, so closing keeps the text.
 */
export function TextAreaModal({ title, initial, onChange, onClose }: TextAreaModalProps) {
  const [value, setValue] = useState(initial);
  const outer = useLayout();
  const active = useIsActive();
  const { body } = modalSize(outer, { maxWidth: outer.width, footer: true });
  // The shell leaves `esc` to the modal, rather than going back from the screen below.
  useKeyCapture(active, { escape: true });
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 'f')) onClose();
    },
    { isActive: active },
  );
  return (
    <Modal title={title} hints={HINTS} maxWidth={outer.width} onClose={onClose}>
      <TextArea
        value={value}
        onChange={(next) => {
          setValue(next);
          onChange(next);
        }}
        width={body.width}
        rows={body.height ?? UNBOUNDED_ROWS}
        focus={active}
        expandable={false}
      />
    </Modal>
  );
}
