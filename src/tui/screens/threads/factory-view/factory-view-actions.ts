import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { withMember, withoutMember } from "../../../../services/store/store.js";
import type { ThreadRecord } from "../../../../services/thread/thread.js";
import { type KeyHint, moveDelta } from "../../../keymap.js";
import { type FactoryViewRow, sectionRowId, type ThreadSection } from "../factory-view-rows.js";

/** What the handlers of the Factory view read and change. */
export interface FactoryViewEnv {
  readonly rows: readonly FactoryViewRow[];
  readonly cursor: number;
  readonly setSelectedId: Dispatch<SetStateAction<string | null>>;
  readonly setCollapsed: Dispatch<SetStateAction<ReadonlySet<string>>>;
  readonly onOpen: (thread: ThreadRecord) => void;
}

/** Collapses or expands `section`. */
function fold(env: FactoryViewEnv, section: ThreadSection, folded: boolean): void {
  env.setCollapsed((current) => (folded ? withMember(current, section) : withoutMember(current, section)));
}

/** Selects the row at `index`, inside the limits of the rows. */
function selectRow(env: FactoryViewEnv, index: number): void {
  const at = env.rows[Math.max(0, Math.min(env.rows.length - 1, index))];

  env.setSelectedId(at?.id ?? null);
}

/** The keys of a section heading: `enter` or space expands or collapses it, and `←/→` collapse and expand it. */
function sectionKey(env: FactoryViewEnv, row: Extract<FactoryViewRow, { kind: "section" }>, input: string, key: Key) {
  if (key.return || input === " ") {
    fold(env, row.section, !row.collapsed);
  } else if (key.leftArrow || key.rightArrow) {
    fold(env, row.section, key.leftArrow);
  }
}

/** The keys of a Thread: `enter` opens it, and `←` collapses its section and selects the heading. */
function threadKey(env: FactoryViewEnv, row: Extract<FactoryViewRow, { kind: "thread" }>, key: Key): void {
  if (key.return) {
    // The selection stays on the row when the Thread Modal closes, also when new Threads come above it.
    env.setSelectedId(row.id);
    env.onOpen(row.thread);
  } else if (key.leftArrow) {
    fold(env, row.section, true);
    env.setSelectedId(sectionRowId(row.section));
  }
}

/** Routes a key of the Factory view: `↑/↓` and `j/k` move, then the keys of the selected row. */
export function handleFactoryViewKey(env: FactoryViewEnv, input: string, key: Key): void {
  const row = env.rows[env.cursor];
  const delta = moveDelta(input, key);

  if (key.ctrl || key.meta) {
    return;
  }

  if (delta) {
    selectRow(env, env.cursor + delta);
  } else if (row?.kind === "section") {
    sectionKey(env, row, input, key);
  } else if (row?.kind === "thread") {
    threadKey(env, row, key);
  }
}

/** A click on a row selects it. A heading also expands or collapses, and a Thread also opens. */
export function clickRow(env: FactoryViewEnv, index: number): void {
  const at = env.rows[index];

  env.setSelectedId(at?.id ?? null);

  if (at?.kind === "section") {
    fold(env, at.section, !at.collapsed);
  } else if (at?.kind === "thread") {
    env.onOpen(at.thread);
  }
}

/** The keys of the Factory view for the selected row. */
export function factoryViewHints(row: FactoryViewRow | undefined): readonly KeyHint[] {
  const rowHint: KeyHint[] =
    row?.kind === "section"
      ? [{ key: "enter", description: row.collapsed ? "expand" : "collapse" }]
      : [{ key: "enter", description: "open Thread" }];

  return [
    { key: "↑/↓", description: "select" },
    ...(row ? rowHint : []),
    { key: "←/→", description: "collapse/expand", secondary: true },
  ];
}
