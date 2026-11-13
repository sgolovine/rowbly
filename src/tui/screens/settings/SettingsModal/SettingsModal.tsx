import { useState } from "react";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Modal } from "../../../components/index.js";
import type { KeyHint } from "../../../keymap.js";
import { SettingsBody } from "../SettingsBody/index.js";
import { SETTINGS_GROUPS, type SettingsGroup } from "../settingsSections.js";

/**
 * The settings of the project (`,`), in a screen Modal: the section list on the left and the selected
 * section on the right. The Forms that a section opens are generic Modals on top.
 */
export function SettingsModal({
  ctx,
  projectName,
  groups = SETTINGS_GROUPS,
  section,
  onChange,
  onClose,
}: {
  ctx: ServiceContext;
  projectName?: string;
  groups?: readonly SettingsGroup[];
  /** The id of a section that opens with the focus. */
  section?: string;
  /** A section changed the project. */
  onChange(): void;
  onClose(): void;
}) {
  const [hints, setHints] = useState<readonly KeyHint[]>([]);
  return (
    <Modal
      title={projectName ? `${projectName} › Settings` : "Settings"}
      size="screen"
      flush
      hints={hints}
      onClose={onClose}
    >
      <SettingsBody
        ctx={ctx}
        groups={groups}
        section={section}
        onChange={onChange}
        onClose={onClose}
        onHints={setHints}
      />
    </Modal>
  );
}
