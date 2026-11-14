import { useInput } from "ink";
import { useEffect, useState } from "react";
import { groupThreads, listThreads, type ThreadRecord } from "../../../../services/thread/thread.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  type AsyncState,
  type Layout,
  useAsync,
  useLayout,
  useReportHints,
  useThreadChanges,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { type FactoryViewRow, factoryViewCursor, factoryViewRows } from "../factory-view-rows.js";
import { type FactoryViewEnv, factoryViewHints, handleFactoryViewKey } from "./factory-view-actions.js";

/** The props of `FactoryView`. */
export interface FactoryViewProps {
  readonly ctx: ServiceContext;
  /** The root of the Project, for the watch of the Thread files. */
  readonly root: string;
  /** The key of the Stage of the filter, or `undefined` for all Stages. */
  readonly stage: string | undefined;
  /** The names of the Stages by key. */
  readonly stages: Readonly<Record<string, string>>;
  /** The view takes the keys. */
  readonly active: boolean;
  /** The rows take the clicks. */
  readonly clickable: boolean;
  /** The line that shows when there is no Thread. */
  readonly emptyText: string;
  onOpen(thread: ThreadRecord): void;
  onHints(hints: readonly KeyHint[]): void;
}

/** The state of the Factory view that its render reads. */
export interface FactoryViewModel {
  readonly env: FactoryViewEnv;
  readonly data: AsyncState<readonly ThreadRecord[]>;
  readonly rows: readonly FactoryViewRow[];
  readonly empty: boolean;
  readonly now: number;
  readonly layout: Layout;
}

/** All worker Threads, read again when a Thread file changes. */
async function loadThreads(ctx: ServiceContext): Promise<readonly ThreadRecord[]> {
  return (await listThreads({ role: "worker" }, ctx)).threads;
}

/** The time that counts up each second while a Thread runs, for its run time. */
function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);

  useEffect(() => {
    if (!running) {
      return;
    }

    const timer = setInterval(() => setNow(Date.now()), 1000);

    return () => clearInterval(timer);
  }, [running]);

  return now;
}

/** The data, the selection, the sections and the keys of the Factory view. */
export function useFactoryView(props: FactoryViewProps): FactoryViewModel {
  const { ctx, root, stage, active, onOpen, onHints } = props;
  const layout = useLayout();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The collapsed sections; they last until Rowbly quits.
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const data = useAsync(() => loadThreads(ctx), [ctx]);

  // The factory writes the Thread files from another process.
  useThreadChanges(root, data.refresh);

  const groups = groupThreads(data.data ?? [], stage);
  const rows = factoryViewRows(groups, collapsed);
  const cursor = factoryViewCursor(rows, selectedId);
  const now = useNow(groups.active.some((thread) => thread.status === "running"));
  const env: FactoryViewEnv = { rows, cursor, setSelectedId, setCollapsed, onOpen };

  useInput((input, key) => handleFactoryViewKey(env, input, key), { isActive: active });
  useReportHints(onHints, factoryViewHints(rows[cursor]));

  return {
    env,
    data,
    rows,
    empty: groups.active.length === 0 && groups.inactive.length === 0,
    now,
    layout,
  };
}
