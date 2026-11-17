import { Box } from "ink";
import { Button, ConversationView, conversationKeys } from "../../../components/index.js";
import { useReportHints } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import {
  STEER_INPUT_ROWS,
  THREAD_DETAIL_ROWS,
  ThreadDetail,
  ThreadSteerInput,
  threadName,
} from "../../stories/index.js";
import { ThreadChecks, threadCheckRows } from "../thread-checks/index.js";
import { type ThreadPaneProps, useThreadPane } from "./use-thread-pane.js";

/** Below this body height, the pane shows the compact detail, so that the conversation keeps its room. */
const FULL_DETAIL_MIN_HEIGHT = THREAD_DETAIL_ROWS + 10;

/**
 * The keys of the pane: the keys of the conversation, `ctrl+f`, `m` for a running worker Thread, `o` when the Story can
 * open, then `tab` and `esc`. The steering input has only its own keys.
 */
function threadPaneHints(live: boolean, steerable: boolean, story: boolean, steering: boolean): readonly KeyHint[] {
  if (steering) {
    return [
      { key: "enter", description: "send" },
      { key: "esc", description: "leave the input" },
    ];
  }

  return [
    ...conversationKeys(live),
    { key: "ctrl+f", description: "full screen" },
    ...(steerable ? [{ key: "m", description: "message" }] : []),
    ...(story ? [{ key: "o", description: "open Story" }] : []),
    { key: "tab", description: "next pane", secondary: true },
    { key: "esc", description: "Thread list" },
  ];
}

/** The rows outside the conversation: the Button row, the detail, the checks and the steering input. */
function headRows(compact: boolean, checks: number, button: boolean, steerable: boolean): number {
  return (button ? 1 : 0) + (compact ? 2 : THREAD_DETAIL_ROWS) + checks + (steerable ? STEER_INPUT_ROWS : 0);
}

/** The rows of the conversation: the body less the rows above it and one blank row. */
function conversationHeight(body: number | undefined, head: number): number | undefined {
  return body === undefined ? undefined : Math.max(2, body - head - 1);
}

/**
 * The content of a Thread in the Story sidebar of the Factory view. It shows the metadata of the Thread, its last
 * checks, then its conversation, which follows the new entries while the Thread runs. It is read-only, except for the
 * steering input under the conversation of a running Thread: `m` or a click focuses it, and `enter` sends its text to
 * the agent. Its size comes from the layout of the sidebar body. When the board has the Story of the Thread, an
 * `Open Story` Button (`o`) opens it. `ctrl+f` shows the conversation over the whole terminal. `esc` gives the focus
 * back to the Thread list. A wheel notch over the conversation scrolls it and gives the focus to the sidebar, also
 * when a different pane has the focus.
 */
export function ThreadPane(props: ThreadPaneProps) {
  const { ctx, onHints, onOpenStory, stages } = props;
  const { active, steering, setSteering, full, current, now, layout } = useThreadPane(props);
  const live = current.status === "running";
  // Only a live worker takes a steering message. An old supervisor Thread does not.
  const steerable = live && current.role === "worker";
  const compact = layout.height !== undefined && layout.height < FULL_DETAIL_MIN_HEIGHT;

  const head = headRows(compact, threadCheckRows(current.checks), onOpenStory !== undefined, steerable);

  useReportHints(onHints, threadPaneHints(live, steerable, onOpenStory !== undefined, steering));

  return (
    <Box flexDirection="column" width={layout.width}>
      {onOpenStory && (
        <Box>
          <Button
            label="Open Story"
            keyName="o"
            onClick={onOpenStory}
            clickable={props.clickable && !full.isOpen}
            compact
          />
        </Box>
      )}
      <ThreadDetail thread={current} now={now} compact={compact} />
      <ThreadChecks checks={current.checks} />
      <Box marginTop={1}>
        <ConversationView
          ctx={ctx}
          threadId={current.id}
          live={live}
          active={active && !steering}
          wheel={props.clickable && !full.isOpen}
          onWheelFocus={props.onFocus}
          width={layout.width}
          height={conversationHeight(layout.height, head)}
        />
      </Box>
      {steerable && (
        <ThreadSteerInput
          key={current.id}
          ctx={ctx}
          threadId={current.id}
          name={`${current.storyId ?? "Factory"} ${threadName(current, stages)}`}
          focused={steering}
          clickable={props.clickable && active}
          width={layout.width}
          onFocus={() => setSteering(true)}
          onLeave={() => setSteering(false)}
        />
      )}
      {/* Outside the shell there is nothing to cover, so the full-screen view shows here. */}
      {full.inline}
    </Box>
  );
}
