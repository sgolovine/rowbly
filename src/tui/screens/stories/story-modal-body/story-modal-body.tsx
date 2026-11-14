import { Box, Text } from "ink";
import { Tabs } from "../../../components/index.js";
import { LayoutContext } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { StoryConfirmDialogs } from "../story-confirm-dialogs/index.js";
import { StoryGeneralTab } from "../story-general-tab/index.js";
import { STORY_PADDING_X, StoryTabPanes } from "../story-tab-panes/index.js";
import { submitStory } from "./story-modal-body-actions.js";
import { type StoryModalBodyProps, useStoryModalBody } from "./use-story-modal-body.js";

export type { StoryModalConfirm } from "./story-modal-body-view.js";

/**
 * The edit form of a Story in the Story sidebar. `shift+tab` or a click changes the tab. The tabs stay mounted, so that a
 * change of tab keeps the text that is not saved. The Threads tab reads its data only after it is selected.
 * The Delete Button and `ctrl+d` of the General tab ask before they delete the Story.
 */
export function StoryModalBody(props: StoryModalBodyProps) {
  const { ctx, storyId, stages, specs = true, confirming, onConfirming } = props;
  const body = useStoryModalBody(props);
  const { env, idle, generalLayout } = body;
  const general = env.shown === "general";
  const { summary } = env.paste;

  return (
    <Box flexDirection="column" height={body.layout.height}>
      <Box paddingX={STORY_PADDING_X} paddingTop={1} flexShrink={0}>
        <Tabs
          tabs={body.labels}
          selected={env.tab}
          onSelect={(index) => env.setTabId(env.tabIds[index] ?? "general")}
          active={idle}
        />
      </Box>
      {summary && (
        <Box paddingX={STORY_PADDING_X}>
          <Text color={theme.inkMuted}>{summary}</Text>
        </Box>
      )}
      <LayoutContext.Provider value={generalLayout}>
        <Box display={general ? "flex" : "none"} flexDirection="column" paddingX={STORY_PADDING_X} paddingY={1}>
          <StoryGeneralTab
            fields={props.fields}
            initialValues={props.initialValues}
            height={generalLayout.height}
            active={idle && general}
            formActive={general && confirming === null}
            submitRequest={body.submitRequest}
            onSubmit={(values) => submitStory(env, values)}
            onDelete={() => onConfirming("delete")}
          />
        </Box>
      </LayoutContext.Provider>
      <StoryTabPanes
        ctx={ctx}
        storyId={storyId}
        stages={stages}
        specs={specs}
        shown={env.shown}
        open={confirming === null}
        specsLayout={body.specsLayout}
        generalLayout={generalLayout}
        reports={body.reports}
      />
      <StoryConfirmDialogs confirming={confirming} onDelete={props.onDelete} onConfirming={onConfirming} />
    </Box>
  );
}
