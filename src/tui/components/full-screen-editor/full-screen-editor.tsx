import { Box } from "ink";
import { useIsActive, useLayout } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { ConfirmDialog } from "../confirm-dialog/index.js";
import { EditorModeTab } from "../editor-mode-tab/index.js";
import { MarkdownView } from "../markdown-view/index.js";
import { Modal, modalSize } from "../modal/index.js";
import { SaveStatus } from "../save-status/index.js";
import { TextArea } from "../text-area/index.js";
import { type EditorMode, useEditorState } from "./use-editor-state.js";

export type { EditorMode } from "./use-editor-state.js";

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

/** The keys of the editor. `ctrl+s` saves when the editor can save, and otherwise closes it. */
function editorHints(mode: EditorMode, saves: boolean): KeyHint[] {
  return [
    mode === "view" ? { key: "tab/e", description: "edit" } : { key: "tab", description: "view" },
    ...(mode === "view" ? [{ key: "↑/↓", description: "scroll" }] : []),
    { key: "ctrl+s", description: saves ? "save" : "close" },
    { key: "esc", description: "close" },
  ];
}

/**
 * A text in a modal as large as the area it covers, in two modes: `view` renders the markdown and
 * scrolls, and `edit` shows the raw text. `tab` or a click on a mode switches mode (`e` also edits); `esc`, `ctrl+f` and
 * the `✕` in its border close it. Every edit goes to `onChange`; `ctrl+s` closes a field editor. With `onSave`, it saves and
 * closing with unsaved changes asks before discarding them.
 */
export function FullScreenEditor({
  title,
  initial,
  mode: initialMode = "edit",
  onChange,
  onSave,
  onClose,
}: FullScreenEditorProps) {
  const outer = useLayout();
  const active = useIsActive();
  const editor = useEditorState({ initial, initialMode, active, onChange, onSave, onClose });

  const { mode, keys } = editor;
  const { body } = modalSize(outer, { size: "screen", maxWidth: outer.width, footer: true });
  const rows = body.height === undefined ? UNBOUNDED_ROWS : Math.max(1, body.height - MODE_ROWS);

  return (
    <Modal
      title={title}
      hints={editorHints(mode, onSave !== undefined)}
      size="screen"
      maxWidth={outer.width}
      onClose={editor.confirming ? undefined : editor.close}
    >
      <Box gap={1} height={1} marginBottom={MODE_ROWS - 1} flexShrink={0}>
        <EditorModeTab label="View" selected={mode === "view"} active={keys} onClick={() => editor.setMode("view")} />
        <EditorModeTab label="Edit" selected={mode === "edit"} active={keys} onClick={() => editor.setMode("edit")} />
        <SaveStatus save={editor.save} dirty={editor.dirty} />
      </Box>
      {mode === "view" ? (
        // As tall as the text box, so switching modes keeps the editor's size.
        <Box flexDirection="column" height={rows} flexShrink={0}>
          <MarkdownView
            text={editor.value}
            width={body.width}
            height={rows}
            active={keys}
            emptyText="No text yet. Press e to write some."
          />
        </Box>
      ) : (
        <TextArea
          value={editor.value}
          onChange={editor.edit}
          width={body.width}
          rows={rows}
          focus={keys}
          expandable={false}
        />
      )}
      {editor.confirming && (
        <ConfirmDialog
          title="Discard changes"
          message="Close and discard unsaved changes?"
          confirmLabel="Discard"
          cancelLabel="Keep editing"
          destructive
          isActive={active}
          onConfirm={onClose}
          onCancel={() => editor.setConfirming(false)}
        />
      )}
    </Modal>
  );
}
