import type { Key } from "ink";

/** One key and what it does, as shown in the footer and the help overlay. */
export interface KeyHint {
  key: string;
  description: string;
  /** Left out of the footer to keep it short; the help overlay still lists it. */
  secondary?: boolean;
}

/** The keys the shell handles on every screen, as the help overlay lists them. */
export const GLOBAL_KEYS: readonly KeyHint[] = [
  { key: "↑/↓", description: "move" },
  { key: "tab", description: "focus the next pane: Stages, Story list, Story sidebar" },
  { key: "shift+tab", description: "focus the previous pane (in the Story list)" },
  { key: "[/]", description: "previous/next Stage" },
  { key: "enter", description: "expand or collapse the Stage section (in All Stages)" },
  { key: "←/→", description: "collapse/expand the Stage section (in All Stages)" },
  { key: "n", description: "new Story, or new Stage in the Stage sidebar" },
  { key: "e", description: "edit the Stage (in the Stage sidebar)" },
  { key: "shift+↑/↓", description: "move the Stage up or down (in the Stage sidebar)" },
  { key: "shift+↑/↓", description: "move the Story up or down, then into the next Stage (in the Story list)" },
  { key: "ctrl+shift+↑/↓", description: "move the Story to the previous or next Stage (in the Story list)" },
  { key: "d", description: "delete the Story (in the Story list)" },
  { key: "ctrl+d", description: "delete the Story (in an open Story)" },
  { key: "ctrl+p", description: "find Stories" },
  { key: "p", description: "switch Project" },
  { key: "ctrl+b", description: "show or hide the Stage sidebar" },
  { key: "f", description: "factory controls" },
  { key: ",", description: "settings" },
  { key: "ctrl+f", description: "edit a text field full screen" },
  { key: "esc", description: "back" },
  { key: "esc", description: "focus the Story list (in the Story sidebar)" },
  { key: "esc", description: "close the Story sidebar (in the Story list)" },
  { key: "?", description: "help" },
  { key: "q", description: "quit" },
  { key: "j/k", description: "move (vim keys)", secondary: true },
  { key: "J/K", description: "move the Stage or the Story down or up (vim keys)", secondary: true },
];

/**
 * The keys of a `Form`, for screens that show one: saving first, so a narrow hint strip keeps it.
 * `ctrl+enter` saves too, where the terminal tells it from `enter` (the user guide says so).
 */
export const FORM_KEYS: readonly KeyHint[] = formKeys("save");

/**
 * `FORM_KEYS` with `ctrl+s` described as `submit`, for a Form that does not save (e.g. `apply` for a filter).
 * With `enterSubmits`, the hints say that `enter` submits instead of moving to the next field.
 */
export function formKeys(submit: string, enterSubmits = false): readonly KeyHint[] {
  return [
    { key: enterSubmits ? "enter/ctrl+s" : "ctrl+s", description: submit },
    { key: enterSubmits ? "tab" : "tab/enter", description: "next field" },
    { key: "shift+tab", description: "previous field" },
  ];
}

/**
 * `↑/↓` move, with `j`/`k` as alternatives. Pass `vim: false` where `j`/`k` are typed text.
 * `shift+↑/↓` is left to screens, where it moves the selected entry (like `K`/`J`).
 */
export function moveDelta(input: string, key: Key, vim = true): -1 | 0 | 1 {
  if (key.shift && (key.upArrow || key.downArrow)) {
    return 0;
  }

  if (key.upArrow || (vim && input === "k")) {
    return -1;
  }

  if (key.downArrow || (vim && input === "j")) {
    return 1;
  }

  return 0;
}

/** `shift+↑/↓`, with `K`/`J` as alternatives: moves the selected entry up or down its list. */
export function reorderDelta(input: string, key: Key): -1 | 0 | 1 {
  if (key.ctrl) {
    return 0;
  }

  if (key.shift && key.upArrow) {
    return -1;
  }

  if (key.shift && key.downArrow) {
    return 1;
  }

  if (input === "K") {
    return -1;
  }

  if (input === "J") {
    return 1;
  }

  return 0;
}

/** `ctrl+shift+↑/↓`: moves the selected entry to the previous or next group, for example a Story to a Stage. */
export function groupDelta(key: Key): -1 | 0 | 1 {
  if (!key.ctrl || !key.shift) {
    return 0;
  }

  if (key.upArrow) {
    return -1;
  }

  if (key.downArrow) {
    return 1;
  }

  return 0;
}

/** Whether a key submits the form from any field: `ctrl+enter`, or `ctrl+s` where the terminal cannot tell `ctrl+enter` from `enter`. */
export function isSubmitKey(input: string, key: Key): boolean {
  return (key.return && key.ctrl) || (key.ctrl && input === "s");
}
