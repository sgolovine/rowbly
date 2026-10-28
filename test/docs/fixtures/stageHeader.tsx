// #region stage-header
import type { PluginStageHeaderProps, PluginTui } from '../../../src/plugin-api';
import { Button, useIsActive } from '../../../src/plugin-api/tui';

function StageHeader({ boardId, stage, active, ui }: PluginStageHeaderProps) {
  const focused = useIsActive();
  return (
    <Button label="✎" compact clickable={active && focused} onClick={() => ui.toast(`${boardId}: ${stage.name}`)} />
  );
}

export const stageHeaderTui: PluginTui = { stageHeader: StageHeader };
// #endregion
