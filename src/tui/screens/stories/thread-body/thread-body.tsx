import { Box } from "ink";
import type { ReactNode } from "react";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import type { ThreadConnection } from "../../../../services/thread-connection/thread-connection.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { ConversationView } from "../../../components/index.js";
import { ThreadDetail } from "../thread-detail/index.js";
import { ThreadSteerInput } from "../thread-steer-input/index.js";

export interface ThreadBodyProps {
  readonly ctx: ServiceContext;
  readonly thread: ThreadRecord;
  /** The time for the run time of a running thread. */
  readonly now: number;
  /** The thread shows only its status and outcome rows. */
  readonly compact: boolean;

  // The detail of the thread.
  /** The lost connection of the thread. */
  readonly connection?: ThreadConnection;
  /** The number of held entries of the thread, when it is abandoned. */
  readonly held?: number;

  // The slots of the screen.
  /** The content above the detail. */
  readonly header?: ReactNode;
  /** The content between the detail and the conversation. */
  readonly beforeConversation?: ReactNode;

  // The conversation.
  /** The body shows the conversation. */
  readonly showConversation: boolean;
  /** The conversation takes the keys. */
  readonly conversationActive: boolean;
  /** A wheel notch over the conversation scrolls it. */
  readonly wheel?: boolean;
  /** A wheel notch over the conversation gives the focus to the screen. */
  readonly onWheelFocus?: () => void;
  readonly width: number;
  readonly conversationHeight: number | undefined;

  // The steering input.
  /** The body shows the steering input. */
  readonly steerable: boolean;
  /** The name of the thread in the steering input. */
  readonly steerName: string;
  /** The steering input takes the keys. */
  readonly steering: boolean;
  readonly steerClickable: boolean;
  /** `m` or a click on the steering input. */
  readonly onFocusSteer: () => void;
  /** `esc` in the steering input. */
  readonly onLeaveSteer: () => void;
}

/**
 * The body of a thread: the detail, the conversation and the steering input. It has no frame of its own, so that the
 * Threads tab of the Story modal and the Story sidebar of the Factory view each keep their own frame.
 */
export function ThreadBody({
  ctx,
  thread,
  now,
  compact,
  connection,
  held,
  header,
  beforeConversation,
  showConversation,
  conversationActive,
  wheel,
  onWheelFocus,
  width,
  conversationHeight,
  steerable,
  steerName,
  steering,
  steerClickable,
  onFocusSteer,
  onLeaveSteer,
}: ThreadBodyProps) {
  return (
    <>
      {header}
      <ThreadDetail thread={thread} now={now} compact={compact} connection={connection} held={held} />
      {beforeConversation}
      {showConversation && (
        <Box marginTop={1}>
          <ConversationView
            key={thread.id}
            ctx={ctx}
            threadId={thread.id}
            live={thread.status === "running"}
            active={conversationActive}
            wheel={wheel}
            onWheelFocus={onWheelFocus}
            width={width}
            height={conversationHeight}
          />
        </Box>
      )}
      {steerable && (
        <ThreadSteerInput
          key={thread.id}
          ctx={ctx}
          threadId={thread.id}
          name={steerName}
          focused={steering}
          clickable={steerClickable}
          width={width}
          onFocus={onFocusSteer}
          onLeave={onLeaveSteer}
        />
      )}
    </>
  );
}
