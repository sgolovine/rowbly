import { Box, type DOMElement } from "ink";
import { type ReactNode, useRef } from "react";
import { SelectionRow } from "../../../components/index.js";
import { useMouse } from "../../../hooks/index.js";

/** The props of `FactoryListItem`. */
export interface FactoryListItemProps {
  readonly children: ReactNode;
  /** The action of a click. Without it, the row takes no click. */
  readonly onClick?: () => void;
  /** False while a dialog or a different view has the keys. */
  readonly clickable: boolean;
  /**
   * The selection state of a row that a user can select. With a value, the row shows the selection bar
   * column and, when it is `true`, the bar and the selection fill. Without a value, the row has no bar column.
   */
  readonly selected?: boolean;
}

/** One row of a `FactoryList`. A click on it runs `onClick`. */
export function FactoryListItem({ children, onClick, clickable, selected }: FactoryListItemProps) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick }, clickable && onClick !== undefined && selected === undefined);

  if (selected !== undefined) {
    return (
      <SelectionRow selected={selected} active={clickable} onClick={onClick}>
        {children}
      </SelectionRow>
    );
  }

  return <Box ref={ref}>{children}</Box>;
}
