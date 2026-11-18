import { useInput } from "ink";
import { type Dispatch, type SetStateAction, useEffect, useState } from "react";
import { listSpecs, type Spec } from "../../../../services/spec/spec.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { useCovered } from "../../../components/index.js";
import {
  type AsyncState,
  type Layout,
  useAsync,
  useCursor,
  useEscape,
  useIsActive,
  useLayout,
  useReportHints,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import type { SpecMode } from "../spec-dialogs/index.js";
import { handleEditKey, handleListKey, type SpecsTabEnv, showList } from "./specs-tab-actions.js";
import { specsHints } from "./specs-tab-view.js";
import { useSpecDrafts } from "./use-spec-drafts.js";

export interface SpecsTabProps {
  readonly ctx: ServiceContext;
  readonly storyId: string;
  /** This tab is the tab on the screen, and takes the keys. */
  readonly selected: boolean;
  onCount(count: number): void;
  /** The text editor takes `esc`, so that the Modal does not close. */
  onEditing(editing: boolean): void;
  onHints(hints: readonly KeyHint[]): void;
}

/** The state of the Specs tab that its render reads. */
export interface SpecsTabState {
  readonly env: SpecsTabEnv;
  readonly list: AsyncState<Spec[]>;
  readonly specs: readonly Spec[];
  readonly mode: SpecMode;
  readonly layout: Layout;
  readonly listing: boolean;
  readonly editing: boolean;
}

/** Tells the parent the count of specs and the editing state when they change. */
function useParentReports(props: SpecsTabProps, count: number | undefined, editing: boolean): void {
  const { onCount, onEditing } = props;

  useEffect(() => {
    if (count !== undefined) {
      onCount(count);
    }
  }, [count, onCount]);
  useEffect(() => {
    onEditing(editing);
  }, [editing, onEditing]);
}

/** Selects a new spec after the reload puts it in the list, and opens its text. */
function useSelectNew(env: SpecsTabEnv, selectSlug: string | null, specs: readonly Spec[]): void {
  const { setCursor, setSelectSlug, setMode } = env;

  useEffect(() => {
    const index = selectSlug === null ? -1 : specs.findIndex((spec) => spec.slug === selectSlug);

    if (index !== -1) {
      setCursor(index);
      setSelectSlug(null);
      setMode({ kind: "edit" });
    }
  }, [selectSlug, specs, setCursor, setSelectSlug, setMode]);
}

/** Goes back to the list when the edited spec goes away. */
function useEditReset(
  mode: SpecMode,
  current: Spec | undefined,
  data: Spec[] | undefined,
  setMode: Dispatch<SetStateAction<SpecMode>>,
): void {
  useEffect(() => {
    if (mode.kind === "edit" && !current && data !== undefined) {
      setMode({ kind: "list" });
    }
  }, [mode.kind, current, data, setMode]);
}

/** The state, the effects and the keys of the Specs tab. */
export function useSpecsTab(props: SpecsTabProps): SpecsTabState {
  const { ctx, storyId, selected, onHints } = props;
  const active = useIsActive();
  const covered = useCovered();
  const layout = useLayout();
  const toast = useToast();
  const [mode, setMode] = useState<SpecMode>({ kind: "list" });
  const drafts = useSpecDrafts(ctx);
  const [selectSlug, setSelectSlug] = useState<string | null>(null);
  const list = useAsync(() => listSpecs({ story: storyId }, ctx), [ctx, storyId]);

  const specs = list.data ?? [];
  const keysOwn = active && selected && !covered;
  const listing = keysOwn && mode.kind === "list" && list.data !== undefined;
  const editing = keysOwn && mode.kind === "edit";
  const [cursor, setCursor] = useCursor(specs.length, listing);
  const current = specs[cursor];
  const hints = specsHints({ keysOwn, editing, count: specs.length, current });

  const env: SpecsTabEnv = {
    ctx,
    storyId,
    toast,
    drafts,
    current,
    cursor,
    setMode,
    setCursor,
    setSelectSlug,
    reload: list.reload,
  };

  useParentReports(props, list.data?.length, editing);
  useSelectNew(env, selectSlug, specs);
  useEditReset(mode, current, list.data, setMode);
  useEscape(editing, () => showList(env));
  useInput((input, key) => handleEditKey(env, input, key), { isActive: editing });
  useInput((input, key) => handleListKey(env, input, key), { isActive: listing });
  useReportHints(onHints, hints);

  return { env, list, specs, mode, layout, listing, editing };
}
