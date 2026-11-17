import { type Dispatch, type RefObject, type SetStateAction, useEffect, useRef } from "react";
import { collapsedStageKeys } from "../../../services/stage/stage.js";
import { writeRef } from "../../hooks/refs.js";
import type { Board } from "./shell-state.js";

/** Collapses the Stage sections of `board` that have `expandedByDefault: false`, one time for each Project that opens. */
function applyStageDefaults(
  board: Board | null | undefined,
  appliedRoot: RefObject<string | undefined>,
  setCollapsed: Dispatch<SetStateAction<ReadonlySet<string>>>,
): void {
  if (!board || board.project.root === appliedRoot.current) {
    return;
  }

  writeRef(appliedRoot, board.project.root);
  setCollapsed(new Set(collapsedStageKeys(board.stages)));
}

/**
 * Sets the collapsed Stage sections of All Stages from the config when a Project opens: at the start and after a
 * Project switch. A reload of the same Project keeps the sections that the user expanded or collapsed, also when a
 * failed load cleared the board for a time.
 */
export function useStageDefaults(
  board: Board | null | undefined,
  setCollapsed: Dispatch<SetStateAction<ReadonlySet<string>>>,
): void {
  const appliedRoot = useRef<string | undefined>(undefined);

  // biome-ignore lint/correctness/useExhaustiveDependencies: apply only when the root of the board changes.
  useEffect(() => {
    applyStageDefaults(board, appliedRoot, setCollapsed);
  }, [board?.project.root]);
}
