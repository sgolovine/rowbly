import { Box, Text, useInput } from "ink";
import { useState } from "react";
import { listStages, type Stage, updateStage } from "../../../../services/stage/stage.js";
import { Loading, SelectionRow, StageBadge, Switch } from "../../../components/index.js";
import { useAsync, useIsActive, useKeyHints, useToast } from "../../../hooks/index.js";
import { moveDelta, reorderDelta } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { StageFormModal } from "../../stages/index.js";
import { stageCategory } from "../../stories/index.js";
import type { SettingsSectionProps } from "../settingsSections.js";

type Mode = { kind: "list" } | { kind: "new" } | { kind: "edit"; stage: Stage };

/**
 * The Stages of the project, in board order. `n` creates a Stage, `enter` or `e` edits the selected
 * Stage, `space` enables or disables it, and `shift+↑/↓` moves it. A click on a row edits its Stage, and a
 * click on a Switch enables or disables its Stage.
 */
export function StagesSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const list = useAsync(() => listStages(ctx), [ctx]);
  const stages = list.data ?? [];
  const cursor = Math.max(
    0,
    stages.findIndex((s) => s.key === selectedKey),
  );
  const current = stages[cursor];
  const idle = active && mode.kind === "list";

  const changed = () => {
    list.reload();
    onChange();
  };
  const save = (stage: Stage, input: { enabled?: boolean; position?: number }) =>
    updateStage({ key: stage.key, ...input }, ctx).then(changed, (err: unknown) => toast.error(err));
  const toggle = (stage: Stage) => save(stage, { enabled: !stage.enabled });
  const move = (stage: Stage, shift: number) => {
    const position = stage.position + shift;
    if (position < 1 || position > stages.length) return;
    // The selection follows the Stage to its new place.
    setSelectedKey(stage.key);
    save(stage, { position });
  };

  useKeyHints(
    idle
      ? [
          { key: "↑/↓", description: "select" },
          { key: "n", description: "new Stage" },
          ...(current
            ? [
                { key: "enter", description: "edit" },
                { key: "space", description: current.enabled ? "disable" : "enable" },
                { key: "shift+↑/↓", description: "move" },
              ]
            : []),
        ]
      : [],
  );
  useInput(
    (input, key) => {
      const shift = reorderDelta(input, key);
      const delta = moveDelta(input, key);
      if (input === "n") setMode({ kind: "new" });
      else if (!current) return;
      else if (shift) move(current, shift);
      else if (delta) setSelectedKey(stages[Math.max(0, Math.min(stages.length - 1, cursor + delta))]?.key ?? null);
      else if (key.return || input === "e") setMode({ kind: "edit", stage: current });
      else if (input === " ") toggle(current);
    },
    { isActive: idle },
  );

  if (!list.data) return list.loading ? <Loading label="Loading Stages…" /> : null;
  const labelWidth = Math.max(0, ...stages.map((s) => s.label.length)) + 4;
  const keyWidth = Math.max(0, ...stages.map((s) => s.key.length)) + 2;
  return (
    <Box flexDirection="column">
      {stages.length === 0 && <Text color={theme.inkFaint}>No Stages. Press n to create one.</Text>}
      {stages.map((stage, i) => (
        <SelectionRow
          key={stage.key}
          selected={i === cursor}
          active={idle}
          onClick={() => {
            setSelectedKey(stage.key);
            setMode({ kind: "edit", stage });
          }}
        >
          <Box>
            <Box width={labelWidth} flexShrink={0}>
              <StageBadge stage={{ name: stage.label, category: stageCategory(stages, stage.key) }} />
            </Box>
            <Box width={keyWidth} flexShrink={0}>
              <Text color={i === cursor ? theme.inkMuted : theme.inkFaint}>{stage.key}</Text>
            </Box>
            <Switch
              on={stage.enabled}
              onLabel="Enabled"
              offLabel="Disabled"
              onChange={() => toggle(stage)}
              clickable={idle}
            />
          </Box>
        </SelectionRow>
      ))}
      {mode.kind !== "list" && (
        <StageFormModal
          ctx={ctx}
          stage={mode.kind === "edit" ? mode.stage : undefined}
          onClose={() => setMode({ kind: "list" })}
          onSaved={(saved) => {
            setSelectedKey(saved.key);
            setMode({ kind: "list" });
            changed();
          }}
        />
      )}
    </Box>
  );
}
