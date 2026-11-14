import { Box, type DOMElement } from "ink";
import { useMemo, useRef, useState } from "react";
import type { Story } from "../../../services/story/story.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import {
  CloseButton,
  PaneBody,
  Panel,
  ResizeEdge,
  STORY_SIDEBAR_MIN_WIDTH,
  useModalLayers,
} from "../../components/index.js";
import { ActiveContext, useReportHints } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import type { OverlayBoard, StoryPane } from "../overlay.js";
import { StorySidebarForm } from "../story-sidebar-form/index.js";
import { storyBodyLayout, storySidebarHints, storySidebarTitle } from "./story-sidebar-view.js";

const NO_HINTS: readonly KeyHint[] = [];

export interface StorySidebarProps {
  readonly pane: StoryPane;
  readonly board: OverlayBoard;
  readonly ctx: ServiceContext;
  /** The Stage that a new Story starts in. */
  readonly cursorStage: string | undefined;

  // The size.
  /** The columns of the Story sidebar, with its border. */
  readonly width: number;
  readonly height: number | undefined;
  /** The most columns that a drag of the left edge can give. */
  readonly maxWidth: number;
  /** A drag of the left edge calls it with the new width; `undefined` when the edge does not drag. */
  readonly onResize: ((width: number) => void) | undefined;

  // The focus.
  /** The Story sidebar is on the screen. A hidden Story sidebar keeps its form and its draft. */
  readonly shown: boolean;
  /** The form takes the keys. */
  readonly focused: boolean;
  /** The Story sidebar takes the mouse. */
  readonly clickable: boolean;

  // The handlers.
  /** A click in the Story sidebar while it does not have the focus. */
  onFocus(): void;
  /** The `✕`. The shell asks before it discards unsaved changes. */
  onClose(): void;
  /** `esc` in the form: the focus goes to the Story list, and the form keeps its draft. */
  onBack(): void;
  onSaved(story: Story): void;
  onDeleted(id: string): void;
  /** The keys of the Story sidebar, for the footer. */
  onHints(hints: readonly KeyHint[]): void;
}

/** The key of the form: a different Story, a new Story or a different Project mounts a new form. */
function formKey(ctx: ServiceContext, pane: StoryPane): string {
  return `${ctx.cwd ?? ""}:${pane.kind === "new" ? "new" : pane.story.id}`;
}

/**
 * The Story sidebar on the right of the Story list: a `Panel` with the form of a new Story or the edit form
 * of a Story, its title in the top border and a `✕` at the right end of the top border. A drag of its left
 * edge changes its width. The confirmations of the form show over its body. Its keys go to the footer.
 */
export function StorySidebar(props: StorySidebarProps) {
  const { pane, width, height, shown, focused, clickable } = props;
  const ref = useRef<DOMElement>(null);
  const layers = useModalLayers();
  const [ownHints, setOwnHints] = useState<readonly KeyHint[]>(NO_HINTS);

  const edit = pane.kind === "edit";
  const hints = storySidebarHints(layers.leads, edit ? ownHints : NO_HINTS);
  const mouse = clickable && !layers.covered;
  // Kept stable, so the form does not render again when the hints change.
  const layout = useMemo(() => storyBodyLayout(pane, width, height), [pane, width, height]);

  useReportHints(props.onHints, hints);

  return (
    <Box ref={ref} display={shown ? "flex" : "none"} flexShrink={0} width={width} height={height}>
      <ActiveContext.Provider value={mouse}>
        <Panel
          title={storySidebarTitle(pane)}
          paddingX={0}
          aside={<CloseButton onClick={props.onClose} />}
          focused={focused}
          width={width}
          height={height}
          onClick={mouse && !focused ? props.onFocus : undefined}
        >
          <ActiveContext.Provider value={focused}>
            <PaneBody layers={layers} layout={layout} flush={edit} scroll={!edit}>
              <StorySidebarForm
                key={formKey(props.ctx, pane)}
                pane={pane}
                board={props.board}
                ctx={props.ctx}
                cursorStage={props.cursorStage}
                onBack={props.onBack}
                onSaved={props.onSaved}
                onDeleted={props.onDeleted}
                onHints={setOwnHints}
              />
            </PaneBody>
          </ActiveContext.Provider>
        </Panel>
        {props.onResize && (
          <ResizeEdge
            target={ref}
            side="left"
            width={width}
            minWidth={STORY_SIDEBAR_MIN_WIDTH}
            maxWidth={props.maxWidth}
            active={mouse}
            onResize={props.onResize}
          />
        )}
      </ActiveContext.Provider>
    </Box>
  );
}
