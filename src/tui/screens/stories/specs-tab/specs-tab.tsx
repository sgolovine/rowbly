import { Box } from "ink";
import { Loading } from "../../../components/index.js";
import { SpecDialogs } from "../spec-dialogs/index.js";
import { SpecListPanel } from "../spec-list-panel/index.js";
import { SpecPanel } from "../spec-panel/index.js";
import { clickRow, createStorySpec, removeStorySpec, renameStorySpec, showList } from "./specs-tab-actions.js";
import { editorSize, GAP, LIST_WIDTH } from "./specs-tab-view.js";
import { type SpecsTabProps, useSpecsTab } from "./use-specs-tab.js";

/**
 * The specs of one Story, in two Panels: the list on the left and the Markdown text of the selected spec on
 * the right. `enter`, `tab` or a click on the text edits it. `tab`, `esc` or a click in the list goes back to
 * the list. The text saves automatically, and `ctrl+s` saves it at once. `n` creates a spec, `r` renames it
 * and `d` removes it from the Story. A spec with no other Story is deleted.
 */
export function SpecsTab(props: SpecsTabProps) {
  const tab = useSpecsTab(props);
  const { env, layout } = tab;
  const { current, drafts } = env;
  const editor = editorSize(layout);

  if (!tab.list.data) {
    return tab.list.loading ? <Loading label="Loading the specs…" /> : null;
  }

  return (
    <Box columnGap={GAP} height={layout.height}>
      <SpecListPanel
        specs={tab.specs}
        cursor={env.cursor}
        width={LIST_WIDTH}
        height={layout.height}
        listing={tab.listing}
        editing={tab.editing}
        isUnsaved={drafts.isUnsaved}
        onFocusList={() => showList(env)}
        onClickRow={(index) => clickRow(env, index)}
        onNew={() => env.setMode({ kind: "new" })}
      />
      <SpecPanel
        current={current}
        text={current ? drafts.textOf(current) : ""}
        height={layout.height}
        editorWidth={editor.width}
        editorRows={editor.rows}
        listing={tab.listing}
        editing={tab.editing}
        onFocusEditor={() => env.setMode({ kind: "edit" })}
        onChange={(spec, text) => drafts.edit(spec, text)}
      />
      <SpecDialogs
        mode={tab.mode}
        storyId={props.storyId}
        onCreate={(values) => createStorySpec(env, values)}
        onRename={(spec, values) => renameStorySpec(env, spec, values)}
        onRemove={(spec) => void removeStorySpec(env, spec)}
        onClose={() => showList(env)}
      />
    </Box>
  );
}
