import type { FormLead } from "../../components/index.js";
import { type Layout, uniqueKeys } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import type { StoryPane } from "../overlay.js";

/** `esc` in the Story sidebar gives the focus to the Story list. */
const BACK_HINT: KeyHint = { key: "esc", description: "Story list" };

/** The columns and the rows of the padding around the new Story form. */
const FORM_PADDING_X = 4;
const FORM_PADDING_Y = 2;

/** The title in the top border of the Story sidebar, as the Modals had. */
export function storySidebarTitle(pane: StoryPane): string {
  return pane.kind === "new" ? "New Story" : `Edit ${pane.story.id}`;
}

/** The size of the content of the Story sidebar: inside its border, and inside the padding of the new Story form. */
export function storyBodyLayout(pane: StoryPane, width: number, height: number | undefined): Layout {
  const padX = pane.kind === "new" ? FORM_PADDING_X : 0;
  const padY = pane.kind === "new" ? FORM_PADDING_Y : 0;

  return {
    width: Math.max(1, width - 2 - padX),
    height: height === undefined ? undefined : Math.max(1, height - 2 - padY),
  };
}

/**
 * The keys of the Story sidebar for the footer: the keys of the Form first, then the keys of the tab, and `esc`
 * last. A region of a tab that takes `esc` keeps its own `esc`, else `esc` goes back to the Story list.
 */
export function storySidebarHints(leads: readonly FormLead[], own: readonly KeyHint[]): KeyHint[] {
  const esc = own.find((hint) => hint.key === "esc") ?? BACK_HINT;

  return uniqueKeys([
    ...leads.flatMap((lead) => lead.keys).filter((hint) => hint.key !== "esc"),
    ...own.filter((hint) => hint.key !== "esc"),
    esc,
  ]);
}
