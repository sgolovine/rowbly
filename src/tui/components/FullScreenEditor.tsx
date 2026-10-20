import { Box, Text, useInput } from 'ink';
import { type ReactNode, useRef, useState } from 'react';
import { useIsActive, useKeyCapture, useLayout } from '../hooks';
import type { KeyHint } from '../keymap';
import { ConfirmDialog } from './ConfirmDialog';
import { MarkdownView } from './MarkdownView';
import { Modal, modalSize } from './Modal';
import { TextArea } from './TextArea';

/** `view` shows the markdown rendered; `edit` shows the raw text in a `TextArea`. */
export type EditorMode = 'view' | 'edit';

export interface FullScreenEditorProps {
  /** Shown in the top edge of the border. */
  title: string;
  /** The text when it opens; from then on the editor holds the text. */
  initial: string;
  /** The mode it opens in. Defaults to `edit`. */
  mode?: EditorMode;
  /** Called with every edit. */
  onChange?(value: string): void;
  /**
   * Saves the text; `ctrl+s` calls it. A rejection keeps the text unsaved and shows its message.
   * With it, closing with unsaved changes asks first.
   */
  onSave?(value: string): Promise<void>;
  onClose(): void;
}

/** Rows of text when the editor grows with its content (tests, piped output) rather than filling the terminal. */
const UNBOUNDED_ROWS = 10;
/** The row above the text that shows the mode and whether the text is saved, and a blank row under it. */
const MODE_ROWS = 2;

type SaveState = { kind: 'idle' | 'saving' | 'saved' } | { kind: 'failed'; message: string };

/**
 * A text in a modal as large as the area it covers, in two modes: `view` renders the markdown and
 * scrolls, and `edit` shows the raw text. `tab` switches mode (`e` also edits); `esc`, `ctrl+f` and
 * the `✕` in its border close it. Every edit goes to `onChange`; with `onSave`, `ctrl+s` saves and
 * closing with unsaved changes asks before discarding them.
 */
export function FullScreenEditor({
  title,
  initial,
  mode: initialMode = 'edit',
  onChange,
  onSave,
  onClose,
}: FullScreenEditorProps) {
  const [value, setValue] = useState(initial);
  const [mode, setMode] = useState<EditorMode>(initialMode);
  const [saved, setSaved] = useState(initial);
  const [save, setSave] = useState<SaveState>({ kind: 'idle' });
  const [confirming, setConfirming] = useState(false);
  // The latest text, for a save that starts before the edit's render.
  const latest = useRef(initial);
  const outer = useLayout();
  const active = useIsActive();
  const { body } = modalSize(outer, { maxWidth: outer.width, footer: true });
  const rows = body.height === undefined ? UNBOUNDED_ROWS : Math.max(1, body.height - MODE_ROWS);
  const dirty = onSave !== undefined && value !== saved;
  const keys = active && !confirming && save.kind !== 'saving';

  const close = () => {
    if (dirty) setConfirming(true);
    else onClose();
  };
  const store = async () => {
    if (!onSave) return;
    const text = latest.current;
    setSave({ kind: 'saving' });
    try {
      await onSave(text);
      setSaved(text);
      setSave({ kind: 'saved' });
    } catch (err) {
      setSave({ kind: 'failed', message: err instanceof Error ? err.message : String(err) });
    }
  };

  // The shell leaves `esc` to the editor, rather than going back from the screen below.
  useKeyCapture(active, { escape: true });
  useInput(
    (input, key) => {
      if (key.escape || (key.ctrl && input === 'f')) close();
      else if (key.tab) setMode((m) => (m === 'view' ? 'edit' : 'view'));
      else if (mode === 'view' && input === 'e' && !key.ctrl && !key.meta) setMode('edit');
      else if (onSave && key.ctrl && input === 's') void store();
    },
    { isActive: keys },
  );

  const hints: KeyHint[] = [
    mode === 'view' ? { key: 'tab/e', description: 'edit' } : { key: 'tab', description: 'view' },
    ...(mode === 'view' ? [{ key: '↑/↓', description: 'scroll' }] : []),
    ...(onSave ? [{ key: 'ctrl+s', description: 'save' }] : []),
    { key: 'esc', description: 'close' },
  ];
  return (
    <Modal title={title} hints={hints} maxWidth={outer.width} onClose={confirming ? undefined : close}>
      {confirming ? (
        <ConfirmDialog
          message="Close and discard unsaved changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          isActive={active}
          onConfirm={onClose}
          onCancel={() => setConfirming(false)}
        />
      ) : (
        <>
          <Box gap={1} height={1} marginBottom={MODE_ROWS - 1} flexShrink={0}>
            <Text bold={mode === 'view'} inverse={mode === 'view'}>
              {' View '}
            </Text>
            <Text bold={mode === 'edit'} inverse={mode === 'edit'}>
              {' Edit '}
            </Text>
            {saveStatus(save, dirty)}
          </Box>
          {mode === 'view' ? (
            // As tall as the text box, so switching modes keeps the editor's size.
            <Box flexDirection="column" height={rows} flexShrink={0}>
              <MarkdownView
                text={value}
                width={body.width}
                height={rows}
                active={keys}
                emptyText="No text yet. Press e to write some."
              />
            </Box>
          ) : (
            <TextArea
              value={value}
              onChange={(next) => {
                latest.current = next;
                setValue(next);
                onChange?.(next);
              }}
              width={body.width}
              rows={rows}
              focus={keys}
              expandable={false}
            />
          )}
        </>
      )}
    </Modal>
  );
}

/** Whether the text is saved, shown after the mode; nothing until there is something to save. */
function saveStatus(save: SaveState, dirty: boolean): ReactNode {
  if (save.kind === 'saving') return <Text dimColor>saving…</Text>;
  if (save.kind === 'failed') return <Text color="red" wrap="truncate-end">{`not saved: ${save.message}`}</Text>;
  if (dirty) return <Text color="yellow">unsaved</Text>;
  if (save.kind === 'saved') return <Text color="green">saved</Text>;
  return null;
}
