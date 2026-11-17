import { Box } from "ink";
import { Loading } from "../../../components/index.js";
import { threadHostProps } from "../thread-host-view.js";
import { ThreadListPanel } from "../thread-list-panel/index.js";
import { ThreadPanel } from "../thread-panel/index.js";
import { clickRow } from "./threads-tab-actions.js";
import { ThreadsTabDialogs } from "./threads-tab-dialogs.js";
import { GAP, LIST_WIDTH, threadsLayout } from "./threads-tab-view.js";
import { type ThreadsTabProps, useThreadsTab } from "./use-threads-tab.js";

/**
 * The threads of one Story: each Pi conversation that the factory recorded for it, also the pending, failed,
 * cancelled and interrupted ones. The list is on the left, and the selected thread on the right: its metadata,
 * then its conversation. In a narrow Modal they take turns. The list reads only metadata, and only after the
 * tab is selected the first time. It reads again when the threads or the factory status change. Only the
 * selected thread opens its conversation (a peek, which starts no agent), and it closes when the selection or
 * the tab changes. `ctrl+f` shows the conversation over the whole terminal. `x` asks before it interrupts an active
 * thread, and `r` resumes a resumable thread. The two keys send a command to the running factory. On an abandoned
 * remote thread with held entries, `a` applies the entries and `d` asks before it discards them. A list with a remote
 * thread shows the host of each thread, and a remote thread with a lost connection shows `connection lost`. A running thread
 * shows a steering input under its conversation: `m` or a click focuses it, and `enter` sends its text to the agent.
 * A note tells when the Story waits for a worker slot.
 */
export function ThreadsTab(props: ThreadsTabProps) {
  const { ctx, storyId, stages, selected, compactThreads } = props;
  const tab = useThreadsTab(props);
  const { env, layout, confirm, discard } = tab;
  const view = threadsLayout(layout, tab.focus, env.current);

  if (!tab.data.data) {
    return tab.data.loading && tab.opened ? <Loading label="Loading the threads…" /> : null;
  }

  return (
    <Box columnGap={GAP} height={layout.height}>
      {view.showList && (
        <ThreadListPanel
          threads={tab.threads}
          hostView={tab.hostView}
          held={env.held}
          stages={stages}
          now={tab.now}
          cursor={env.cursor}
          waiting={tab.waiting}
          providers={tab.providers}
          listing={tab.listing}
          viewing={tab.viewing}
          width={view.split ? LIST_WIDTH : layout.width}
          height={layout.height}
          innerHeight={view.innerHeight}
          compactThreads={compactThreads}
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
          connection={env.current && threadHostProps(tab.hostView, env.current).connection}
          held={env.current && env.held[env.current.id]}
          now={tab.now}
          compact={view.compact}
          selected={selected}
          shownId={tab.shownId}
          listing={tab.listing}
          viewing={tab.viewing}
          steering={tab.steering}
          width={view.split ? undefined : layout.width}
          height={layout.height}
          threadWidth={view.threadWidth}
          conversationHeight={view.conversationHeight}
          onFocusThread={() => env.setFocus("thread")}
          onFocusSteer={() => env.setFocus("steer")}
          onLeaveSteer={() => env.setFocus("thread")}
        />
      )}
      <ThreadsTabDialogs env={env} storyId={storyId} stages={stages} confirm={confirm} discard={discard} />
      {/* Outside the shell there is nothing to cover, so the full-screen view shows here. */}
      {tab.full.inline}
    </Box>
  );
}
