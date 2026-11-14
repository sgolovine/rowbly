import { Box, type DOMElement } from "ink";
import { type ReactNode, useRef } from "react";
import { useMouse } from "../../../hooks/index.js";

/** The props of `FactoryListItem`. */
export interface FactoryListItemProps {
  readonly children: ReactNode;
  /** The action of a click. Without it, the row takes no click. */
  readonly onClick?: () => void;
  /** False while a dialog or a different view has the keys. */
  readonly clickable: boolean;
}

/** One row of a `FactoryList`. A click on it runs `onClick`. */
export function FactoryListItem({ children, onClick, clickable }: FactoryListItemProps) {
  const ref = useRef<DOMElement>(null);

  useMouse(ref, { onClick }, clickable && onClick !== undefined);

  return <Box ref={ref}>{children}</Box>;
}
