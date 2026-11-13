import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { SelectList } from "../../../components/index.js";
import { formatDateTime } from "../../../theme.js";
import { historyModel } from "../factory-modal-text.js";

/** The props of `FactoryHistory`. */
export interface FactoryHistoryProps {
  /** The supervisor Threads, the oldest first. */
  readonly threads: readonly ThreadRecord[];
  /** The supervisor that the list highlights first. */
  readonly supervisorId: string | undefined;
  /** The most rows that the room around the Modal lets the list show. */
  readonly height: number | undefined;
  readonly active: boolean;
  readonly onFilteringChange: (filtering: boolean) => void;
  readonly onPick: (id: string) => void;
}

/** The rows of the list that fit in a terminal of `height` rows, from one to eight. */
function historyLimit(height: number | undefined): number {
  return Math.max(1, Math.min(8, (height ?? 20) - 10));
}

/** The supervisor Threads of the factory, the newest first. `enter` picks a Thread to peek. */
export function FactoryHistory({
  threads,
  supervisorId,
  height,
  active,
  onFilteringChange,
  onPick,
}: FactoryHistoryProps) {
  const newest = threads.toReversed();

  return (
    <SelectList
      items={newest.map((thread) => ({
        value: thread.id,
        label: `${formatDateTime(thread.createdAt)} · ${thread.status}`,
        description: historyModel(thread),
      }))}
      defaultIndex={Math.max(
        0,
        newest.findIndex((thread) => thread.id === supervisorId),
      )}
      limit={historyLimit(height)}
      emptyText="No supervisor history"
      isActive={active}
      onFilteringChange={onFilteringChange}
      onSelect={(item) => onPick(item.value)}
    />
  );
}
