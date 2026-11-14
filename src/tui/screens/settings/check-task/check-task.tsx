import { checkLimits } from "../../../../services/factory-settings/check-settings.js";
import type { CheckSpec, FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { ConfirmDialog, FormModal, type FormValues } from "../../../components/index.js";
import type { AiTask } from "../ai-view.js";
import { CHECK_LIMIT_FIELDS, checkFields, checkValues } from "../check-form.js";

/** The props of `CheckTaskView`. */
export interface CheckTaskViewProps {
  readonly task: AiTask;
  readonly settings: FactorySettings | undefined;
  readonly onSaveCheckLimits: (values: FormValues) => Promise<void>;
  /** Without a check, the form adds a new check. */
  readonly onSaveCheck: (check: CheckSpec | undefined, values: FormValues) => Promise<void>;
  readonly onRemoveCheck: (check: CheckSpec) => void;
  readonly onCancel: () => void;
}

/** The check tasks: the check limits, the form of one check, or the confirmation before a check goes away. */
export function CheckTaskView({
  task,
  settings,
  onSaveCheckLimits,
  onSaveCheck,
  onRemoveCheck,
  onCancel,
}: CheckTaskViewProps) {
  const limits = checkLimits(settings?.checks ?? {});

  return (
    <>
      {task?.kind === "checkLimits" && (
        <FormModal
          title="AI › Check limits"
          fields={CHECK_LIMIT_FIELDS}
          initialValues={{
            maxConcurrent: limits?.maxConcurrent ?? 2,
            reserveMemoryMb: limits?.reserveMemoryMb ?? 2048,
          }}
          onSubmit={onSaveCheckLimits}
          onClose={onCancel}
        />
      )}
      {task?.kind === "check" && (
        <FormModal
          title={task.check ? `AI › Check › ${task.check.key}` : "AI › New check"}
          fields={checkFields(!task.check)}
          initialValues={checkValues(task.check)}
          onSubmit={(values) => onSaveCheck(task.check, values)}
          onClose={onCancel}
        />
      )}
      {task?.kind === "removeCheck" && (
        <ConfirmDialog
          title={`AI › Remove check › ${task.check.key}`}
          message={`Remove the check ${task.check.key}? Workers can then run this command in the shell again.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => onRemoveCheck(task.check)}
          onCancel={onCancel}
        />
      )}
    </>
  );
}
