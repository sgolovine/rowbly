import type { FactoryLaunch, FactoryStatus } from "../../../services/factory/factory.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import type { KeyHint } from "../../keymap.js";
import { FactoryModal } from "../../screens/factory/index.js";
import { SettingsModal } from "../../screens/settings/index.js";
import { StageFormModal } from "../../screens/stages/index.js";
import { ThreadModal } from "../../screens/threads/index.js";
import { HelpModal } from "../help-modal/index.js";
import type { Overlay, OverlayBoard, OverlayHandlers } from "../overlay.js";
import { ProjectSwitcher } from "../project-switcher/index.js";
import { StoryOverlays } from "../story-overlays/index.js";

interface ShellOverlaysProps {
  readonly overlay: Overlay | null;
  /** The open Project; `undefined` while it loads, or when there is none. Only the Project switcher and the keys open then. */
  readonly board: OverlayBoard | undefined;
  readonly ctx: ServiceContext;
  readonly launch: FactoryLaunch | undefined;
  readonly factory: FactoryStatus | undefined;
  /** The keys that the help Modal shows. */
  readonly hints: readonly KeyHint[];
  readonly on: OverlayHandlers;
}

/** The labels of the Stages by key, for the Factory controls. */
function stageLabels(board: OverlayBoard): Record<string, string> {
  return Object.fromEntries(board.stages.map((s) => [s.key, s.label]));
}

/** The overlay of the shell that is open, if there is one. */
export function ShellOverlays({ overlay, board, ctx, launch, factory, hints, on }: ShellOverlaysProps) {
  return (
    <>
      {board && <StoryOverlays overlay={overlay} board={board} on={on} />}
      {board && (overlay?.kind === "newStage" || overlay?.kind === "editStage") && (
        <StageFormModal
          ctx={ctx}
          stage={overlay.kind === "editStage" ? overlay.stage : undefined}
          onClose={on.close}
          onSaved={on.stageSaved}
        />
      )}
      {board && overlay?.kind === "settings" && (
        <SettingsModal
          ctx={ctx}
          projectName={board.project.projectName}
          section={overlay.section}
          onChange={on.reload}
          onClose={on.close}
        />
      )}
      {board && overlay?.kind === "factory" && (
        <FactoryModal
          ctx={ctx}
          status={factory}
          stages={stageLabels(board)}
          launch={launch}
          onClose={on.close}
          onAiSettings={on.openAiSettings}
          stories={board.stories}
          onOpenStory={on.openStory}
          onOpenThread={on.openThread}
        />
      )}
      {board && overlay?.kind === "thread" && (
        <ThreadModal
          ctx={ctx}
          root={board.project.root}
          thread={overlay.thread}
          stages={stageLabels(board)}
          onClose={on.close}
        />
      )}
      {overlay?.kind === "projects" && (
        <ProjectSwitcher ctx={ctx} current={board?.project.root} onSelect={on.switchProject} onClose={on.close} />
      )}
      {overlay?.kind === "help" && <HelpModal hints={hints} onClose={on.close} />}
    </>
  );
}
