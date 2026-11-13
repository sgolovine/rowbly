import { Box } from "ink";
import { ConfirmDialog, Loading } from "../../../components/index.js";
import { ThreadListPanel } from "../thread-list-panel/index.js";
import { ThreadPanel } from "../thread-panel/index.js";
import { threadName } from "../thread-text.js";
import { clickRow, confirmInterrupt } from "./threads-tab-actions.js";
import { GAP, LIST_WIDTH, threadsLayout } from "./threads-tab-view.js";
import { type ThreadsTabProps, useThreadsTab } from "./use-threads-tab.js";

/**
 * The threads of one Story: each Pi conversation that the factory recorded for it, also the pending, failed,
 * cancelled and interrupted ones. The list is on the left, and the selected thread on the right: its metadata,
 * then its conversation. In a narrow Modal they take turns. The list reads only metadata, and only after the
 * tab is selected the first time. It reads again when the threads or the factory status change. Only the
 * selected thread opens its conversation (a peek, which starts no agent), and it closes when the selection or
 * the tab changes. `x` asks before it interrupts an active thread, and `r` resumes a resumable thread. The two
 * keys send a command to the running factory. A note tells when the Story waits for a worker slot.
 */
export function ThreadsTab(props: ThreadsTabProps) {
  const { ctx, storyId, stages, selected } = props;
  const tab = useThreadsTab(props);
  const { env, layout, confirm } = tab;
  const view = threadsLayout(layout, tab.focus, env.current);

  if (!tab.data.data) {
    return tab.data.loading && tab.opened ? <Loading label="Loading the threads…" /> : null;
  }

  return (
    <Box columnGap={GAP} height={layout.height}>
      {view.showList && (
        <ThreadListPanel
          threads={tab.threads}
          stages={stages}
          now={tab.now}
          cursor={env.cursor}
          waiting={tab.waiting}
          listing={tab.listing}
          viewing={tab.viewing}
          width={view.split ? LIST_WIDTH : layout.width}
          height={layout.height}
          innerHeight={view.innerHeight}
          onFocusList={() => env.setFocus("list")}
          onClickRow={(index) => clickRow(env, index)}
        />
      )}
      {view.showThread && (
        <ThreadPanel
          ctx={ctx}
          storyId={storyId}
          stages={stages}
          current={env.current}
          now={tab.now}
          compact={view.compact}
          selected={selected}
          shownId={tab.shownId}
          listing={tab.listing}
          viewing={tab.viewing}
          width={view.split ? undefined : layout.width}
          height={layout.height}
          threadWidth={view.threadWidth}
          conversationHeight={view.conversationHeight}
          onFocusThread={() => env.setFocus("thread")}
        />
      )}
      {confirm && (
        <ConfirmDialog
          title={`${storyId} › Threads › Interrupt`}
          message={`Interrupt ${threadName(confirm, stages)}? The worker stops. Rowbly keeps its session and worktree, and r can resume it later.`}
          confirmLabel="Interrupt"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => confirmInterrupt(env, confirm)}
          onCancel={() => env.setConfirm(null)}
        />
      )}
    </Box>
  );
}
