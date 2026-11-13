import { Box, Text } from "ink";
import { useRef, useState } from "react";
import { SKILL_HARNESSES } from "../../../../services/config/config.js";
import type { SkillStatus } from "../../../../services/skill/skill.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, ConfirmDialog, Form, type FormField, Loading, Modal } from "../../../components/index.js";
import { useEscape, useIsActive, useKeyCapture, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import {
  confirmRemoval,
  removalMessage,
  type SkillActionEnv,
  type SkillMode,
  submitSkillForm,
} from "./skill-action.js";

/** Selects harnesses and confirms the paths before removal. */
export function SkillActionModal({
  ctx,
  mode,
  name,
  tracked,
  onClose,
  onSaved,
}: {
  ctx: ServiceContext;
  mode: SkillMode;
  name: string;
  tracked?: SkillStatus;
  onClose(): void;
  onSaved(): void;
}) {
  const active = useIsActive();
  const toast = useToast();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);
  const [submitRequest, setSubmitRequest] = useState(0);
  const [targets, setTargets] = useState<string[] | null>(null);
  const harnesses = mode === "install" ? SKILL_HARNESSES : (tracked?.harnesses.map((h) => h.harness) ?? []);
  const fields: FormField[] = harnesses.map((harness) => ({
    name: harness,
    label: harness,
    kind: "switch",
    switchLabels: { on: "Selected", off: "Not selected" },
  }));
  const initialValues = Object.fromEntries(harnesses.map((h) => [h, mode === "remove"]));
  const idle = active && !busy && targets === null;
  const env: SkillActionEnv = { ctx, mode, name, harnesses, toast, pending, setBusy, setTargets, onSaved };

  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle, onClose);

  return (
    <Modal
      title={`${mode === "install" ? "Install" : "Uninstall"} skill › ${name}`}
      onClose={idle ? onClose : undefined}
      hints={[{ key: "esc", description: "cancel" }]}
    >
      <Box flexDirection="column" gap={1}>
        <Text color={theme.inkMuted}>
          {mode === "install"
            ? "Select one or more harnesses."
            : "All tracked harnesses start selected. Clear any to keep."}
        </Text>
        <Form
          fields={fields}
          initialValues={initialValues}
          onSubmit={(values) => submitSkillForm(env, values)}
          submitLabel={mode === "install" ? "install" : "continue"}
          isActive={idle}
          submitRequest={submitRequest}
        />
        {busy && <Loading label={mode === "install" ? "Installing…" : "Uninstalling…"} />}
        <Box flexWrap="wrap" gap={1}>
          <Button
            label={mode === "install" ? "Install" : "Continue"}
            keyName="ctrl+s"
            compact
            clickable={idle}
            onClick={() => setSubmitRequest((n) => n + 1)}
          />
          <Button label="Cancel" keyName="esc" compact clickable={idle} onClick={onClose} />
        </Box>
      </Box>
      {targets && (
        <ConfirmDialog
          title={`Uninstall skill › ${name}`}
          destructive
          confirmLabel="Uninstall"
          cancelLabel="Cancel"
          message={removalMessage(name, targets, tracked)}
          isActive={!busy}
          onCancel={() => setTargets(null)}
          onConfirm={() => confirmRemoval(env, targets)}
        />
      )}
    </Modal>
  );
}
