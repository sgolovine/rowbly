import { Text } from "ink";
import type { FactoryQueueEntry, FactoryStatus } from "../../../../services/factory/factory.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { Panel, ScrollBody } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { queueReason } from "../../factory/index.js";
import { type ThreadHostView, threadHostProps } from "../thread-host-view.js";
import { ThreadRow } from "../thread-row/index.js";
import type { StageNames } from "../thread-text.js";

export interface ThreadListPanelProps {
  readonly threads: readonly ThreadRecord[];
  /** The live hosts and the host column of the list. */
  readonly hostView: ThreadHostView;
  /** The number of held entries of each abandoned thread, by thread id. */
  readonly held: Readonly<Record<string, number>>;
  /** The names of the Stages by key. */
  readonly stages?: StageNames;
  /** The time for the run time of a running thread. */
  readonly now: number;
  readonly cursor: number;
  /** The queue entry of the Story, while it waits for a worker slot. */
  readonly waiting: FactoryQueueEntry | undefined;
  /** The provider pauses of the factory status, for the network reason of the queue note. */
  readonly providers?: FactoryStatus["providers"];
  /** The list takes the keys. */
  readonly listing: boolean;
  /** The thread region takes the keys. */
  readonly viewing: boolean;
  readonly width: number;
  readonly height: number | undefined;
  /** The height inside the frame, or undefined when the content sets the height. */
  readonly innerHeight: number | undefined;
  /** Each thread uses one line. */
  readonly compactThreads?: boolean;
  /** A click on the Panel while the thread region has the keys. */
  readonly onFocusList: () => void;
  readonly onClickRow: (index: number) => void;
}

/** The queue note with a capital first letter. */
function waitingNote(waiting: FactoryQueueEntry, providers: FactoryStatus["providers"]): string {
  return queueReason(waiting, providers).replace(/^./, (c) => c.toUpperCase());
}

/** The rows that the thread rows can use: the inner height less the queue note. */
function scrollHeight(innerHeight: number | undefined, waiting: FactoryQueueEntry | undefined): number | undefined {
  return innerHeight === undefined ? undefined : Math.max(1, innerHeight - (waiting ? 1 : 0));
}

/** The list of the threads of a Story in the Threads tab, with the queue note above it. */
export function ThreadListPanel({
  threads,
  hostView,
  held,
  stages,
  now,
  cursor,
  waiting,
  providers,
  listing,
  viewing,
  width,
  height,
  innerHeight,
  compactThreads = false,
  onFocusList,
  onClickRow,
}: ThreadListPanelProps) {
  return (
    <Panel
      title="Threads"
      focused={listing}
      onClick={viewing ? onFocusList : undefined}
      flexShrink={0}
      width={width}
      height={height}
      overflow="hidden"
    >
      {waiting && (
        <Text wrap="truncate-end" color={theme.inkMuted}>
          {waitingNote(waiting, providers)}
        </Text>
      )}
      {threads.length === 0 && <Text color={theme.inkFaint}>No Threads</Text>}
      <ScrollBody active={listing} height={scrollHeight(innerHeight, waiting)}>
        {threads.map((thread, i) => (
          <ThreadRow
            key={thread.id}
            thread={thread}
            stages={stages}
            now={now}
            selected={i === cursor}
            clickable={listing || viewing}
            compact={compactThreads}
            held={held[thread.id]}
            {...threadHostProps(hostView, thread)}
            onClick={() => onClickRow(i)}
          />
        ))}
      </ScrollBody>
    </Panel>
  );
}
