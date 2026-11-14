import { Box, Text } from "ink";
import type { ComponentProps } from "react";
import type { FactoryActivity } from "../../../services/factory-activity/factory-activity.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { Loading, Panel } from "../../components/index.js";
import { ActiveContext, type Layout, LayoutContext } from "../../hooks/index.js";
import type { KeyHint } from "../../keymap.js";
import { Onboarding } from "../../screens/onboarding/index.js";
import { FactoryStatusLine, StoryList } from "../../screens/stories/index.js";
import { FactoryView } from "../../screens/threads/index.js";
import { theme } from "../../theme.js";

/**
 * What the Story panel shows: the first load, the Stories of a Project, the worker Threads of the Factory view,
 * the onboarding steps or a read error.
 */
export type StoryPanelBody =
  | { readonly kind: "loading" }
  | {
      readonly kind: "board";
      readonly list: ComponentProps<typeof StoryList>;
      readonly activity: FactoryActivity;
      /** A problem with the factory state file takes one line below the list. */
      readonly statusLine: boolean;
    }
  | { readonly kind: "threads"; readonly view: ComponentProps<typeof FactoryView> }
  | {
      readonly kind: "onboarding";
      readonly ctx: ServiceContext;
      readonly active: boolean;
      onHints(hints: readonly KeyHint[]): void;
      onCreated(): void;
    }
  | { readonly kind: "error" };

interface StoryPanelProps {
  readonly title: string;
  readonly focused: boolean;
  readonly height: number | undefined;
  /** The room inside the Panel. */
  readonly inner: Layout;
  /** A click on the Panel; `undefined` when the Panel is not clickable. */
  readonly onClick: (() => void) | undefined;
  readonly body: StoryPanelBody;
}

/**
 * The Panel of the Story list, or of the Factory view. Without a Project, it holds the onboarding steps, because
 * they have no Modal.
 */
export function StoryPanel({ title, focused, height, inner, onClick, body }: StoryPanelProps) {
  return (
    <Panel
      title={title}
      focused={focused}
      onClick={onClick}
      flexGrow={1}
      flexShrink={1}
      height={height}
      overflow="hidden"
    >
      <LayoutContext.Provider value={inner}>
        {body.kind === "loading" && <Loading label="Loading Stories…" />}
        {body.kind === "board" && (
          <>
            <StoryList {...body.list} />
            {body.statusLine && (
              <Box flexGrow={1} alignItems="flex-end">
                <FactoryStatusLine activity={body.activity} />
              </Box>
            )}
          </>
        )}
        {body.kind === "threads" && <FactoryView {...body.view} />}
        {body.kind === "onboarding" && (
          <ActiveContext.Provider value={body.active}>
            <Onboarding ctx={body.ctx} onHints={body.onHints} onCreated={body.onCreated} />
          </ActiveContext.Provider>
        )}
        {body.kind === "error" && <Text color={theme.danger}>Rowbly could not read the project.</Text>}
      </LayoutContext.Provider>
    </Panel>
  );
}
