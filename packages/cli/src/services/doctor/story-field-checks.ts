import type { CustomField, ProjectConfig } from "../config/config.js";
import { coerceFieldValue, fieldValueError } from "../fields/fields.js";
import { mapInOrder } from "../in-order/in-order.js";
import type { Store } from "../store/store.js";
import { type DocRepair, type DoctorIssue, type DoctorRun, noted, reportChange } from "./doctor-run.js";

/** A missing field gets no value. A value of the wrong type has a fix when the text converts to the type. */
async function fieldIssue(
  run: DoctorRun,
  repair: Store<DocRepair>,
  field: CustomField,
  file: string,
): Promise<DoctorIssue[]> {
  const { data } = repair.current;

  if (!(field.key in data)) {
    return [
      await reportChange(
        run,
        repair,
        { severity: "error", message: `Custom field "${field.key}" is missing`, file, fix: "Add it with no value" },
        (state) => ({ data: { ...state.data, [field.key]: null } }),
      ),
    ];
  }

  const error = fieldValueError(field, data[field.key]);

  if (!error) {
    return [];
  }

  const coerced = coerceFieldValue(
    field,
    typeof data[field.key] === "string" ? data[field.key] : String(data[field.key]),
  );

  if (!coerced.ok) {
    return [noted({ severity: "error", message: error, file })];
  }

  return [
    await reportChange(
      run,
      repair,
      { severity: "error", message: error, file, fix: `Change it to ${JSON.stringify(coerced.value)}` },
      (state) => ({ data: { ...state.data, [field.key]: coerced.value } }),
    ),
  ];
}

/** Each custom field of the project must be in the Story, with a value of its type. */
export async function fieldIssues(
  run: DoctorRun,
  config: ProjectConfig,
  repair: Store<DocRepair>,
  file: string,
): Promise<DoctorIssue[]> {
  const issues = await mapInOrder(config.customFields, (field) => fieldIssue(run, repair, field, file));

  return issues.flat();
}
