import type { Key } from "ink";
import type { Dispatch, SetStateAction } from "react";
import { type Stage, updateStage } from "../../../../services/stage/stage.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import type { AsyncState, ToastStore } from "../../../hooks/index.js";
import { type KeyHint, moveDelta, reorderDelta } from "../../../keymap.js";

/** The section shows the list, or a Form that creates or edits a Stage. */
export type StagesMode =
  | { readonly kind: "list" }
  | { readonly kind: "new" }
  | { readonly kind: "edit"; readonly stage: Stage };

/** What the handlers of the Stages section read and change. */
export interface StagesEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly list: AsyncState<Stage[]>;
  readonly stages: readonly Stage[];
  readonly cursor: number;
  readonly current: Stage | undefined;
  readonly setMode: Dispatch<SetStateAction<StagesMode>>;
  readonly setSelectedKey: Dispatch<SetStateAction<string | null>>;
  readonly onChange: () => void;
}

/** The keys of the list. A selected Stage adds edit, toggle and move. */
export function stagesHints(idle: boolean, current: Stage | undefined): KeyHint[] {
  if (!idle) {
    return [];
  }

  return [
    { key: "↑/↓", description: "select" },
    { key: "n", description: "new Stage" },
    ...(current
      ? [
          { key: "enter", description: "edit" },
          { key: "space", description: current.enabled ? "disable" : "enable" },
          { key: "shift+↑/↓", description: "move" },
        ]
      : []),
  ];
}

/** Reads the Stages again, also in the screens behind Settings. */
function stagesChanged(env: StagesEnv): void {
  env.list.reload();
  env.onChange();
}

function saveStage(env: StagesEnv, stage: Stage, input: { enabled?: boolean; position?: number }): void {
  updateStage({ key: stage.key, ...input }, env.ctx).then(
    () => stagesChanged(env),
    (err: unknown) => env.toast.error(err),
  );
}

/** Enables or disables a Stage. */
export function toggleStage(env: StagesEnv, stage: Stage): void {
  saveStage(env, stage, { enabled: !stage.enabled });
}

/** Moves a Stage by `shift` places, inside the board. The selection follows the Stage to its new place. */
function moveStage(env: StagesEnv, stage: Stage, shift: number): void {
  const position = stage.position + shift;

  if (position < 1 || position > env.stages.length) {
    return;
  }

  env.setSelectedKey(stage.key);
  saveStage(env, stage, { position });
}

/** Selects a Stage from the list, or a Stage that a Form saved, and goes back to the list. */
export function selectStage(env: StagesEnv, stage: Stage, mode: StagesMode): void {
  env.setSelectedKey(stage.key);
  env.setMode(mode);
}

/** Goes back to the list with the saved Stage selected, and reads the Stages again. */
export function stageSaved(env: StagesEnv, saved: Stage): void {
  selectStage(env, saved, { kind: "list" });
  stagesChanged(env);
}

/** `n` creates a Stage. The other keys need a selected Stage. */
export function handleStagesKey(env: StagesEnv, input: string, key: Key): void {
  if (input === "n") {
    env.setMode({ kind: "new" });

    return;
  }

  if (env.current) {
    handleStageKey(env, env.current, input, key);
  }
}

function handleStageKey(env: StagesEnv, current: Stage, input: string, key: Key): void {
  const shift = reorderDelta(input, key);
  const delta = moveDelta(input, key);

  if (shift) {
    moveStage(env, current, shift);

    return;
  }

  if (delta) {
    env.setSelectedKey(env.stages[Math.max(0, Math.min(env.stages.length - 1, env.cursor + delta))]?.key ?? null);

    return;
  }

  if (key.return || input === "e") {
    env.setMode({ kind: "edit", stage: current });

    return;
  }

  if (input === " ") {
    toggleStage(env, current);
  }
}
