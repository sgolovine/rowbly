import { Box, type Key, Text, useInput, usePaste } from "ink";
import { type RefObject, useRef } from "react";
import { useKeyCapture, useLatest, writeRef } from "../../hooks/index.js";
import { theme } from "../../theme.js";
import { FullScreenButton } from "../full-screen-button/index.js";
import { type EditState, editKey, follow, moveRow, type Row, rowOf, wrapRows } from "../text-editing.js";
import { useEditState } from "../use-edit-state.js";
import { type FullScreenEditorControl, useFullScreenEditor } from "../use-full-screen-editor.js";
import { WithCaret } from "../with-caret/index.js";

export interface TextAreaProps {
  value: string;
  onChange(value: string): void;
  /** Takes keys and shows the caret. */
  focus?: boolean;
  /** Columns available; lines longer than this wrap. */
  width: number;
  /** Rows shown; more text scrolls to keep the caret in view. */
  rows?: number;
  /** Shown dimmed while the value is empty. */
  placeholder?: string;
  /** Called when `↑` on the first row or `↓` on the last would move the caret out of the text. */
  onLeave?(direction: -1 | 1): void;
  /** Shows a Full screen button below the text, and `ctrl+f` opens the text in a `FullScreenEditor`. Defaults to true. */
  expandable?: boolean;
  /** The full-screen editor's title. */
  title?: string;
}

interface TextAreaEnv {
  readonly latest: RefObject<EditState>;
  readonly apply: (next: EditState) => void;
  readonly width: number;
  readonly expandable: boolean;
  readonly onLeave?: (direction: -1 | 1) => void;
  readonly expand: () => void;
}

/** The rows of `text`. One column is kept free so the caret fits after a full row. */
function textRows(text: string, width: number): Row[] {
  return wrapRows(text, width - 1);
}

/** Opens the editor with the latest text. The editor holds the text from then on, and reports every edit to the latest `onChange`. */
function expandText(
  editor: FullScreenEditorControl,
  title: string,
  latest: RefObject<EditState>,
  report: RefObject<(value: string) => void>,
): void {
  editor.open({ title, initial: latest.current.value, mode: "edit", onChange: (next) => report.current(next) });
}

function pasteText(env: TextAreaEnv, text: string): void {
  const next = text ? editKey(env.latest.current, text, {} as Key, true) : null;

  if (next) {
    env.apply(next);
  }
}

function handleTextAreaKey(env: TextAreaEnv, input: string, key: Key): void {
  const state = env.latest.current;

  if (env.expandable && key.ctrl && input === "f") {
    env.expand();

    return;
  }

  if (key.upArrow || key.downArrow) {
    moveCaretRow(env, state, key.upArrow ? -1 : 1);

    return;
  }

  const next = editKey(state, input, key, true);

  if (next) {
    env.apply(next);
  }
}

function moveCaretRow(env: TextAreaEnv, state: EditState, direction: -1 | 1): void {
  const next = moveRow(state, textRows(state.value, env.width), direction);

  if (next) {
    env.apply(next);

    return;
  }

  env.onLeave?.(direction);
}

function rowText(value: string, row: Row): string {
  return value.slice(row.start, row.end);
}

/**
 * A multi-line text input: `enter` starts a new line, `↑/↓` move between rows, and the editing keys of
 * `TextInput` work within a line. While focused, the shell leaves printable keys to it; `tab`, `ctrl+enter` and `esc` go to its parent.
 * Its Full screen button (or `ctrl+f`) opens the text in a `FullScreenEditor` over the whole terminal, in
 * edit mode; every edit there goes to `onChange`, so closing it keeps the text.
 */
export function TextArea({
  value,
  onChange,
  focus = true,
  width,
  rows = 5,
  placeholder,
  onLeave,
  expandable = true,
  title = "Edit text",
}: TextAreaProps) {
  const [{ cursor }, apply, latest] = useEditState(value, onChange);
  const editor = useFullScreenEditor();
  const top = useRef(0);
  const report = useLatest(onChange);

  const expanded = editor.isOpen;
  const editing = focus && !expanded;
  const wrapped = textRows(value, width);
  const current = rowOf(wrapped, cursor);
  const actions = { expand: () => expandText(editor, title, latest, report) };
  const env: TextAreaEnv = { latest, apply, width, expandable, onLeave, expand: actions.expand };

  useKeyCapture(editing);
  usePaste((text) => pasteText(env, text), { isActive: editing });
  useInput((input, key) => handleTextAreaKey(env, input, key), { isActive: editing });

  // The caret is followed only while editing, so a long text shows from its first line until then.
  if (editing) {
    writeRef(top, follow(top.current, current, rows));
  }

  const first = Math.min(top.current, Math.max(0, wrapped.length - rows));
  const caretRow = editing ? current : -1;
  const text = (
    <Box flexDirection="column" height={rows} flexShrink={0} overflow="hidden">
      {!value && !editing ? (
        <Text color={theme.inkFaint}>{placeholder}</Text>
      ) : (
        wrapped.slice(first, first + rows).map((row, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: rows have no identity beyond their position.
          <Text key={i} wrap="truncate-end">
            {/* An empty Text has no height, so a blank line holds a space to keep its row. */}
            {first + i === caretRow ? (
              <WithCaret text={rowText(value, row)} at={cursor - row.start} />
            ) : (
              rowText(value, row) || " "
            )}
            {editing && !value && placeholder && <Text color={theme.inkFaint}>{placeholder}</Text>}
          </Text>
        ))
      )}
    </Box>
  );

  if (!expandable) {
    return text;
  }

  return (
    <Box flexDirection="column" flexShrink={0}>
      {text}
      <Box gap={2}>
        <FullScreenButton focused={focus} clickable={!expanded} onClick={actions.expand} />
        {wrapped.length > rows && (
          <Text color={theme.inkFaint}>
            ↑↓ {first + 1}–{Math.min(wrapped.length, first + rows)} of {wrapped.length}
          </Text>
        )}
      </Box>
      {/* Outside the shell there is nothing to cover, so the editor shows here. */}
      {editor.inline}
    </Box>
  );
}
