import type { Stage } from "../../../services/stage/stage.js";
import type { KeyHint } from "../../keymap.js";
import type { ShellView, StoryListRow } from "./shell-state.js";

/** The keys without a board: the onboarding steps, and the Project switcher. */
function boardlessHints(view: ShellView, onboardingHints: readonly KeyHint[]): KeyHint[] {
  return [
    ...(view.noProject ? onboardingHints : []),
    { key: "p", description: "switch Project", secondary: view.noProject },
  ];
}

function sidebarHints(stage: Stage | undefined): KeyHint[] {
  return [
    { key: "↑/↓", description: "select Stage" },
    { key: "n", description: "new Stage" },
    ...(stage
      ? [
          { key: "e", description: "edit Stage" },
          { key: "shift+↑/↓", description: "move Stage" },
        ]
      : []),
    { key: "tab", description: "Stories" },
    { key: "ctrl+b", description: "hide Stages" },
    { key: "p", description: "switch Project", secondary: true },
  ];
}

/** The keys of the selected row: a heading expands or collapses, and a Story opens or moves. */
function rowHints(row: StoryListRow | undefined): KeyHint[] {
  if (row?.kind === "stage") {
    return [{ key: "enter", description: row.collapsed ? "expand" : "collapse" }];
  }

  return row?.kind === "story"
    ? [
        { key: "enter", description: "edit Story" },
        { key: "shift+↑/↓", description: "move Story" },
        { key: "ctrl+shift+↑/↓", description: "change Stage", secondary: true },
      ]
    : [];
}

/** `tab` goes to the Story sidebar when it is open, else to the Stage sidebar. `esc` closes the Story sidebar. */
function focusHints(view: ShellView): KeyHint[] {
  if (view.storyPane) {
    return [
      { key: "tab", description: "Story" },
      ...(view.sidebar ? [{ key: "shift+tab", description: "Stages", secondary: true }] : []),
      { key: "esc", description: "close Story" },
    ];
  }

  return view.sidebar ? [{ key: "tab", description: "Stages" }] : [];
}

function listHints(view: ShellView, sidebarShown: boolean): KeyHint[] {
  return [
    { key: "↑/↓", description: "select" },
    ...rowHints(view.row),
    { key: "n", description: "new Story" },
    ...(view.row?.kind === "story" ? [{ key: "d", description: "delete" }] : []),
    ...focusHints(view),
    { key: "ctrl+p", description: "find" },
    { key: "p", description: "switch Project", secondary: true },
    { key: "f", description: "factory", secondary: true },
    { key: ",", description: "settings", secondary: true },
    { key: "ctrl+b", description: sidebarShown ? "hide Stages" : "show Stages" },
    ...(view.stage ? [] : [{ key: "←/→", description: "collapse/expand", secondary: true }]),
  ];
}

/** The keys of the Factory view: the keys of its selected row, then the keys of the shell. */
function factoryViewHints(view: ShellView, sidebarShown: boolean, threadHints: readonly KeyHint[]): KeyHint[] {
  return [
    ...threadHints,
    { key: "t", description: "Stories" },
    ...focusHints(view),
    { key: "ctrl+p", description: "find" },
    { key: "p", description: "switch Project", secondary: true },
    { key: "f", description: "factory", secondary: true },
    { key: ",", description: "settings", secondary: true },
    { key: "ctrl+b", description: sidebarShown ? "hide Stages" : "show Stages" },
  ];
}

/** The keys of the region in focus, for the footer and the help Modal. The Story sidebar reports its own keys. */
export function shellHints(
  view: ShellView,
  sidebarShown: boolean,
  onboardingHints: readonly KeyHint[],
  storyHints: readonly KeyHint[] = [],
  threadHints: readonly KeyHint[] = [],
): KeyHint[] {
  if (!view.board) {
    return boardlessHints(view, onboardingHints);
  }

  if (view.storyActive) {
    return [...storyHints];
  }

  if (view.sidebarFocused) {
    return sidebarHints(view.stage);
  }

  return view.mode === "threads" ? factoryViewHints(view, sidebarShown, threadHints) : listHints(view, sidebarShown);
}
