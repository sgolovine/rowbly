import { Text } from "ink";
import { Loading, ScrollBody } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { ThreadRow } from "../../stories/index.js";
import { ThreadSectionRow } from "../thread-section-row/index.js";
import { clickRow } from "./factory-view-actions.js";
import { type FactoryViewProps, useFactoryView } from "./use-factory-view.js";

/**
 * The Factory view: the worker Threads of all Stories in two sections, "Active Threads" (pending and running)
 * and "Inactive Threads" (the Threads that stopped), newest first. With a Stage, only the Threads of that Stage
 * show. `↑/↓` and `j/k` select a row. `enter`, a click or `←/→` expand and collapse a section. `enter` or a click
 * on a Thread calls `onOpen`. The view reads the Threads again when a Thread file changes.
 */
export function FactoryView(props: FactoryViewProps) {
  const { stages, active, clickable, emptyText } = props;
  const { env, data, rows, empty, now, layout } = useFactoryView(props);

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
    <ScrollBody active={active} height={layout.height}>
      {rows.map((row, index) =>
        row.kind === "section" ? (
          <ThreadSectionRow
            key={row.id}
            label={row.label}
            count={row.count}
            collapsed={row.collapsed}
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
            onClick={() => clickRow(env, index)}
          />
        ),
      )}
    </ScrollBody>
  );
}
