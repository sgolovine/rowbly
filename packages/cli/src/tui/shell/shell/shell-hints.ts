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

/** The name of the sidebars in the `ctrl+b` hint: the Stages, and also the tags when the Project has tags. */
function sidebarName(view: ShellView): string {
  return view.tags.length > 0 ? "sidebar" : "Stages";
}

function sidebarHints(view: ShellView, stage: Stage | undefined): KeyHint[] {
  return [
    { key: "↑/↓", description: "select Stage" },
    { key: "n", description: "new Stage" },
    ...(stage
      ? [
          { key: "e", description: "edit Stage" },
          { key: "shift+↑/↓", description: "move Stage" },
        ]
      : []),
    { key: "tab", description: view.tagSidebar ? "Tags" : "Stories" },
    { key: "ctrl+b", description: `hide ${sidebarName(view)}` },
    { key: "p", description: "switch Project", secondary: true },
  ];
}

/** The keys of the tag sidebar. */
function tagSidebarHints(view: ShellView): KeyHint[] {
  return [
    { key: "↑/↓", description: "filter by tag" },
    { key: "n", description: "new tag" },
    { key: "tab", description: "Stories" },
    { key: "shift+tab", description: "Stages", secondary: true },
    { key: "esc", description: "Stories" },
    { key: "ctrl+b", description: `hide ${sidebarName(view)}` },
    { key: "p", description: "switch Project", secondary: true },
  ];
}

/**
 * The keys of the selected row: a heading expands or collapses, and a Story opens, starts the range mode or moves.
 * With a multi-selection, `shift+↑/↓` moves the selected Stories, so the row does not show it.
 */
function rowHints(row: StoryListRow | undefined, marks: boolean): KeyHint[] {
  if (row?.kind === "stage") {
    return [{ key: "enter", description: row.collapsed ? "expand" : "collapse" }];
  }

  return row?.kind === "story"
    ? [
        { key: "enter", description: "edit Story" },
        ...(marks ? [] : [{ key: "space", description: "select" }]),
        ...(marks ? [] : [{ key: "shift+↑/↓", description: "change Stage" }]),
      ]
    : [];
}

/** The keys of the multi-selection: end or cancel the range mode, or move and clear the selected Stories. */
function markHints(view: ShellView): KeyHint[] {
  const count = view.marked.size;

  if (view.ranging) {
    return [
      { key: "space", description: "select" },
      { key: "esc", description: "cancel" },
    ];
  }

  return count > 0
    ? [
        { key: "shift+↑/↓", description: `move ${count} ${count === 1 ? "Story" : "Stories"}` },
        { key: "esc", description: "clear selection" },
      ]
    : [];
}

/**
 * `tab` goes to the Story sidebar when it is open, else to the Stage sidebar. `shift+tab` goes to the tag sidebar
 * when it shows, else to the Stage sidebar. `esc` closes the Story sidebar, but not
 * while `esc` clears a multi-selection (`marks`). The hints name what the Story sidebar shows: a Story, or a Thread.
 */
function focusHints(view: ShellView, marks = false): KeyHint[] {
  if (view.storyPane) {
    const shown = view.storyPane.kind === "thread" ? "Thread" : "Story";

    return [
      { key: "tab", description: shown },
      ...(view.sidebar
        ? [{ key: "shift+tab", description: view.tagSidebar ? "Tags" : "Stages", secondary: true }]
        : []),
      ...(marks ? [] : [{ key: "esc", description: `close ${shown}` }]),
    ];
  }

  return view.sidebar ? [{ key: "tab", description: "Stages" }] : [];
}

function listHints(view: ShellView, sidebarShown: boolean): KeyHint[] {
  const marks = view.ranging || view.marked.size > 0;

  return [
    { key: "↑/↓", description: "select" },
    ...markHints(view),
    ...rowHints(view.row, marks),
    { key: "n", description: "new Story" },
    ...(view.row?.kind === "story" ? [{ key: "d", description: "delete" }] : []),
    ...focusHints(view, marks),
    { key: "ctrl+p", description: "find" },
    { key: "p", description: "switch Project", secondary: true },
    { key: "f", description: "factory", secondary: true },
    { key: ",", description: "settings", secondary: true },
    { key: "ctrl+b", description: `${sidebarShown ? "hide" : "show"} ${sidebarName(view)}` },
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
    { key: "ctrl+b", description: `${sidebarShown ? "hide" : "show"} ${sidebarName(view)}` },
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
    return sidebarHints(view, view.stage);
  }

  if (view.tagSidebarFocused) {
    return tagSidebarHints(view);
  }

  return view.mode === "threads" ? factoryViewHints(view, sidebarShown, threadHints) : listHints(view, sidebarShown);
}
