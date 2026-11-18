import type { Key } from "ink";
import type { Spec } from "../../../../services/spec/spec.js";
import { PANEL_FRAME_HEIGHT, PANEL_FRAME_WIDTH } from "../../../components/index.js";
import type { Layout } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import type { SpecMode } from "../spec-dialogs/index.js";

/** The width of the spec list with its frame, and the gap after it. */
export const LIST_WIDTH = 26;
export const GAP = 1;
/** The rows of the editor when the layout has no height (tests and piped output). */
const DEFAULT_ROWS = 10;
/** The frame, the Stories row, the blank row and the Full screen row around the editor. */
const EDITOR_CHROME = PANEL_FRAME_HEIGHT + 3;

const EDIT_HINTS: readonly KeyHint[] = [
  { key: "ctrl+s", description: "save" },
  { key: "ctrl+f", description: "full screen" },
  { key: "tab", description: "specs", secondary: true },
  { key: "esc", description: "back to specs" },
];

/** What the hints of the tab depend on. */
export interface SpecsHintsInput {
  readonly keysOwn: boolean;
  readonly editing: boolean;
  readonly count: number;
  readonly current: Spec | undefined;
}

/** The keys of the tab: none while another region has the keys, else the keys of the editor or the list. */
export function specsHints({ keysOwn, editing, count, current }: SpecsHintsInput): readonly KeyHint[] {
  if (!keysOwn) {
    return [];
  }

  if (editing) {
    return EDIT_HINTS;
  }

  return [
    ...(count > 0 ? [{ key: "↑/↓", description: "select" }] : []),
    ...(current ? [{ key: "enter/tab", description: "edit" }] : []),
    { key: "n", description: "new Spec" },
    ...(current
      ? [
          { key: "r", description: "rename" },
          { key: "d", description: "remove" },
        ]
      : []),
  ];
}

/** The width and the rows of the editor for `layout`. */
export function editorSize(layout: Layout): { readonly width: number; readonly rows: number } {
  return {
    width: Math.max(20, layout.width - LIST_WIDTH - GAP - PANEL_FRAME_WIDTH),
    rows: layout.height === undefined ? DEFAULT_ROWS : Math.max(3, layout.height - EDITOR_CHROME),
  };
}

/** The mode that a key of the list opens, or undefined for a key that the list does not use. */
export function listKeyMode(current: Spec | undefined, input: string, key: Key): SpecMode | undefined {
  if (key.ctrl || key.meta) {
    return undefined;
  }

  if (input === "n") {
    return { kind: "new" };
  }

  if (!current) {
    return undefined;
  }

  if (key.return || (key.tab && !key.shift)) {
    return { kind: "edit" };
  }

  if (input === "r") {
    return { kind: "rename", spec: current };
  }

  return input === "d" ? { kind: "remove", spec: current } : undefined;
}
