import { SelectList } from "../../../components/index.js";
import type { FactoryProblem } from "../factory-status.js";

/** The most columns of a row. The detail view shows the full text. */
const ROW_WIDTH = 64;

/** The props of `FactoryAttention`. */
export interface FactoryAttentionProps {
  readonly problems: readonly FactoryProblem[];
  /** The most rows that the room around the Modal lets the list show. */
  readonly height: number | undefined;
  readonly active: boolean;
  readonly onFilteringChange: (filtering: boolean) => void;
  /** Opens the detail view of the warning with this key. */
  readonly onPick: (key: string) => void;
}

/** The rows of the list that fit in a terminal of `height` rows, from one to ten. */
function attentionLimit(height: number | undefined): number {
  return Math.max(1, Math.min(10, (height ?? 20) - 10));
}

/** The text of a row on one line, cut with `…` when it is longer than a row. */
function rowText(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();

  return line.length > ROW_WIDTH ? `${line.slice(0, ROW_WIDTH - 1)}…` : line;
}

/**
 * All warnings of the live factory. `enter` opens the detail view of the highlighted warning. A click
 * highlights a warning, and a click on the highlighted warning opens its detail view.
 */
export function FactoryAttention({ problems, height, active, onFilteringChange, onPick }: FactoryAttentionProps) {
  return (
    <SelectList
      items={problems.map((problem) => ({ value: problem.key, label: rowText(problem.text) }))}
      limit={attentionLimit(height)}
      emptyText="No warnings"
      isActive={active}
      onFilteringChange={onFilteringChange}
      clickToHighlight
      onSelect={(item) => onPick(item.value)}
    />
  );
}
