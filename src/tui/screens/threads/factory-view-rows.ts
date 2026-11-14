import type { ThreadGroups, ThreadRecord } from "../../../services/thread/thread.js";

/** A section of the Factory view: the active or the inactive Threads. */
export type ThreadSection = keyof ThreadGroups;

/** A row of the Factory view: the heading of a section, or a Thread. */
export type FactoryViewRow =
  | {
      readonly kind: "section";
      readonly id: string;
      readonly section: ThreadSection;
      readonly label: string;
      readonly count: number;
      readonly collapsed: boolean;
    }
  | {
      readonly kind: "thread";
      readonly id: string;
      readonly section: ThreadSection;
      readonly thread: ThreadRecord;
    };

/** The sections in the order of the view, with their names. */
const SECTIONS: readonly { readonly section: ThreadSection; readonly label: string }[] = [
  { section: "active", label: "Active Threads" },
  { section: "inactive", label: "Inactive Threads" },
];

/** The row id of the heading of `section`. A Thread id cannot contain `:`. */
export function sectionRowId(section: ThreadSection): string {
  return `section:${section}`;
}

function sectionRows(
  groups: ThreadGroups,
  collapsed: ReadonlySet<string>,
  { section, label }: (typeof SECTIONS)[number],
): FactoryViewRow[] {
  const threads = groups[section];
  const folded = collapsed.has(section);
  const heading: FactoryViewRow = {
    kind: "section",
    id: sectionRowId(section),
    section,
    label,
    count: threads.length,
    collapsed: folded,
  };

  if (folded) {
    return [heading];
  }

  return [heading, ...threads.map((thread): FactoryViewRow => ({ kind: "thread", id: thread.id, section, thread }))];
}

/** The rows of the Factory view: each section heading, then its Threads if the section is not collapsed. */
export function factoryViewRows(groups: ThreadGroups, collapsed: ReadonlySet<string>): FactoryViewRow[] {
  return SECTIONS.flatMap((entry) => sectionRows(groups, collapsed, entry));
}

/** The row of the selection. Without a selection, the cursor starts on the first Thread, not on a heading. */
export function factoryViewCursor(rows: readonly FactoryViewRow[], selectedId: string | null): number {
  const selectedAt = rows.findIndex((row) => row.id === selectedId);

  return Math.max(0, selectedAt >= 0 ? selectedAt : rows.findIndex((row) => row.kind === "thread"));
}
