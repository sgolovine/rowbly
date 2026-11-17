import { Box, Text } from "ink";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ThreadConnection } from "../../../../services/thread-connection/thread-connection.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { ConversationView, Panel } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { ThreadDetail } from "../thread-detail/index.js";
import { ThreadSteerInput } from "../thread-steer-input/index.js";
import { type StageNames, threadName } from "../thread-text.js";

export interface ThreadPanelProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** The names of the Stages by key. */
  readonly stages?: StageNames;
  readonly current: ThreadRecord | undefined;
  /** The lost connection of the selected thread. */
  readonly connection?: ThreadConnection;
  /** The number of held entries of the selected thread, when it is abandoned. */
  readonly held?: number;
  /** The time for the run time of a running thread. */
  readonly now: number;
  /** The thread shows only its status and outcome rows. */
  readonly compact: boolean;
  /** The Threads tab is the tab on the screen. */
  readonly selected: boolean;
  /** The id of the thread whose conversation is open. */
  readonly shownId: string | undefined;
  /** The list takes the keys. */
  readonly listing: boolean;
  /** The thread region takes the keys. */
  readonly viewing: boolean;
  /** The steering input of the thread region takes the keys. */
  readonly steering: boolean;
  readonly width: number | undefined;
  readonly height: number | undefined;
  /** The width of the conversation, inside the frame. */
  readonly threadWidth: number;
  readonly conversationHeight: number | undefined;
  /** A click on the Panel while the list has the keys. */
  readonly onFocusThread: () => void;
  /** `m` or a click on the steering input. */
  readonly onFocusSteer: () => void;
  /** `esc` in the steering input. */
  readonly onLeaveSteer: () => void;
}

/** The title of the Panel: the Story and the thread, or "Thread" without a thread. */
export function threadPanelTitle(
  storyId: string,
  current: ThreadRecord | undefined,
  stages: StageNames | undefined,
): string {
  return current ? `${storyId} › ${threadName(current, stages)}` : "Thread";
}

/** The thread region of the Threads tab: the metadata of the selected thread, then its conversation. */
export function ThreadPanel({
  ctx,
  storyId,
  stages,
  current,
  connection,
  held,
  now,
  compact,
  selected,
  shownId,
  listing,
  viewing,
  steering,
  width,
  height,
  threadWidth,
  conversationHeight,
  onFocusThread,
  onFocusSteer,
  onLeaveSteer,
}: ThreadPanelProps) {
  return (
    <Panel
      title={threadPanelTitle(storyId, current, stages)}
      focused={viewing}
      onClick={listing && current ? onFocusThread : undefined}
      flexGrow={1}
      flexShrink={1}
      width={width}
      height={height}
      overflow="hidden"
    >
      {current ? (
        <>
          <ThreadDetail thread={current} now={now} compact={compact} connection={connection} held={held} />
          {selected && shownId === current.id && (
            <Box marginTop={1}>
              <ConversationView
                key={current.id}
                ctx={ctx}
                threadId={current.id}
                live={current.status === "running"}
                active={viewing && !steering}
                width={threadWidth}
                height={conversationHeight}
              />
            </Box>
          )}
          {current.status === "running" && (
            <ThreadSteerInput
              key={current.id}
              ctx={ctx}
              threadId={current.id}
              name={`${storyId} ${threadName(current, stages)}`}
              focused={steering}
              clickable={listing || viewing}
              width={threadWidth}
              onFocus={onFocusSteer}
              onLeave={onLeaveSteer}
            />
          )}
        </>
      ) : (
        <Text color={theme.inkFaint} wrap="wrap">
          The factory adds a thread when it starts a worker for this Story.
        </Text>
      )}
    </Panel>
  );
}
