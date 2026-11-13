import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { listStages, type Stage } from "../../../../services/stage/stage.js";
import { Loading } from "../../../components/index.js";
import { useAsync, useIsActive, useKeyHints, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import { StageFormModal } from "../../stages/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import { StageRow } from "../stage-row/index.js";
import {
  handleStagesKey,
  type StagesEnv,
  type StagesMode,
  selectStage,
  stageSaved,
  stagesHints,
  toggleStage,
} from "./stage-actions.js";

/** The columns of the widest value and `pad` spaces. */
function columnWidth(values: readonly string[], pad: number): number {
  return Math.max(0, ...values.map((value) => value.length)) + pad;
}

/** The place of the selected Stage. Without a selection, or after its Stage is gone, the first Stage. */
function cursorOf(stages: readonly Stage[], selectedKey: string | null): number {
  return Math.max(
    0,
    stages.findIndex((s) => s.key === selectedKey),
  );
}

/**
 * The Stages of the project, in board order. `n` creates a Stage, `enter` or `e` edits the selected
 * Stage, `space` enables or disables it, and `shift+↑/↓` moves it. A click on a row edits its Stage, and a
 * click on a Switch enables or disables its Stage.
 */
export function StagesSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const [mode, setMode] = useState<StagesMode>({ kind: "list" });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const list = useAsync(() => listStages(ctx), [ctx]);

  const stages = list.data ?? [];
  const cursor = cursorOf(stages, selectedKey);
  const current = stages[cursor];
  const idle = active && mode.kind === "list";
  const env: StagesEnv = { ctx, toast, list, stages, cursor, current, setMode, setSelectedKey, onChange };

  useKeyHints(stagesHints(idle, current));
  useInput((input, key) => handleStagesKey(env, input, key), { isActive: idle });

  if (!list.data) {
    return list.loading ? <Loading label="Loading Stages…" /> : null;
  }

  const labelWidth = columnWidth(
    stages.map((s) => s.label),
    4,
  );
  const keyWidth = columnWidth(
    stages.map((s) => s.key),
    2,
  );

  return (
    <Box flexDirection="column">
      {stages.length === 0 && <Text color={theme.inkFaint}>No Stages. Press n to create one.</Text>}
      {stages.map((stage, i) => (
        <StageRow
          key={stage.key}
          stage={stage}
          stages={stages}
          selected={i === cursor}
          idle={idle}
          labelWidth={labelWidth}
          keyWidth={keyWidth}
          onClick={() => selectStage(env, stage, { kind: "edit", stage })}
          onToggle={() => toggleStage(env, stage)}
        />
      ))}
      {mode.kind !== "list" && (
        <StageFormModal
          ctx={ctx}
          stage={mode.kind === "edit" ? mode.stage : undefined}
          onClose={() => setMode({ kind: "list" })}
          onSaved={(saved) => stageSaved(env, saved)}
        />
      )}
    </Box>
  );
}
