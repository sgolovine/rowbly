import { Box, Text } from "ink";
import { useRef, useState } from "react";
import { SKILL_HARNESSES } from "../../../../services/config/config.js";
import { ValidationError } from "../../../../services/errors/errors.js";
import { installSkill, removeSkill, type SkillStatus } from "../../../../services/skill/skill.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import {
  Button,
  ConfirmDialog,
  Form,
  type FormField,
  type FormValues,
  Loading,
  Modal,
} from "../../../components/index.js";
import { useEscape, useIsActive, useKeyCapture, useToast } from "../../../hooks/index.js";
import { theme } from "../../../theme.js";

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
  mode: "install" | "remove";
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
  useKeyCapture(active, { text: false, escape: true });
  useEscape(idle, onClose);

  const run = async (selected: string[]) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const result =
        mode === "install"
          ? await installSkill({ name, harnesses: selected }, ctx)
          : await removeSkill({ name, harnesses: selected }, ctx);
      toast.push(
        "info",
        `${name}: ${result.harnesses.map((h) => `${h.harness}: ${h.status === "shared" ? "shared (folder kept)" : h.status === "missing" ? "already missing" : h.status}`).join("; ")}`,
      );
      onSaved();
    } finally {
      pending.current = false;
      setBusy(false);
    }
  };
  const submit = async (values: FormValues) => {
    const selected = harnesses.filter((h) => values[h] === true);
    if (selected.length === 0) throw new ValidationError("Select at least one harness.");
    if (mode === "remove") setTargets(selected);
    else await run(selected);
  };
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
          onSubmit={submit}
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
          message={`Uninstall ${name} for these harnesses?\n${targets.map((h) => `${h}: ${tracked?.harnesses.find((entry) => entry.harness === h)?.path}`).join("\n")}\nRemoval deletes local changes in removed folders. Another harness can still read a retained or shared skill folder.`}
          isActive={!busy}
          onCancel={() => setTargets(null)}
          onConfirm={() => {
            void run(targets).catch((error: unknown) => {
              toast.error(error);
              setTargets(null);
            });
          }}
        />
      )}
    </Modal>
  );
}
