import { Text } from "ink";
import { Loading, SectionHeadingRow, sectionHeadingRowHeight, VirtualList } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { ThreadRow, threadHostProps, threadRowHeight } from "../../stories/index.js";
import type { FactoryViewRow } from "../factory-view-rows.js";
import { clickRow } from "./factory-view-actions.js";
import { type FactoryViewProps, useFactoryView } from "./use-factory-view.js";

/** The lines of a row of the Factory view. Each heading after the first has an empty line above it. */
function factoryRowHeight(row: FactoryViewRow, index: number, compact: boolean | undefined): number {
  return row.kind === "section" ? sectionHeadingRowHeight(index > 0) : threadRowHeight(row.thread, compact ?? false);
}

/**
 * The Factory view: the worker Threads of all Stories in two sections, "Active Threads" (pending and running)
 * and "Inactive Threads" (the Threads that stopped), newest first. With a Stage, only the Threads of that Stage
 * show. `↑/↓` and `j/k` select a row. `enter`, a click or `←/→` expand and collapse a section. `enter` or a click
 * on a Thread calls `onOpen`. One empty line separates the two sections. The wheel scrolls the rows while the
 * view is `clickable`, also when it is not `active`. With `compact`, each Thread uses one line. The view reads the Threads again when a Thread file changes.
 */
export function FactoryView(props: FactoryViewProps) {
  const { stages, active, clickable, compact, emptyText } = props;
  const { env, data, rows, empty, now, layout, hostView } = useFactoryView(props);

  if (!data.data) {
    return data.loading ? <Loading label="Loading Threads…" /> : null;
  }

  if (empty) {
    return (
      <Text color={theme.inkFaint} wrap="wrap">
        {emptyText}
      </Text>
    );
  }

  return (
    <VirtualList
      active={active}
      wheel={clickable}
      height={layout.height}
      cursor={env.cursor}
      items={rows}
      rowHeight={(row, index) => factoryRowHeight(row, index, compact)}
      renderRow={(row, index) =>
        row.kind === "section" ? (
          <SectionHeadingRow
            key={row.id}
            label={row.label}
            count={row.count}
            collapsed={row.collapsed}
            emptyText="No Threads"
            spaced={index > 0}
            selected={index === env.cursor}
            clickable={clickable}
            onClick={() => clickRow(env, index)}
          />
        ) : (
          <ThreadRow
            key={row.id}
            thread={row.thread}
            storyId={row.thread.storyId}
            stages={stages}
            now={now}
            selected={index === env.cursor}
            clickable={clickable}
            compact={compact}
            {...threadHostProps(hostView, row.thread)}
            onClick={() => clickRow(env, index)}
          />
        )
      }
    />
  );
}
