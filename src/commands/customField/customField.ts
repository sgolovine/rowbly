import { type Command, InvalidArgumentError } from "commander";
import { CUSTOM_FIELD_TYPES, type CustomField, type CustomFieldType } from "../../services/config/config.js";
import { addCustomField, removeCustomField, updateCustomField } from "../../services/customField/customField.js";
import { collect, run } from "../output/output.js";

function parseType(value: string): CustomFieldType {
  if (!CUSTOM_FIELD_TYPES.includes(value as CustomFieldType)) {
    throw new InvalidArgumentError(`Expected one of ${CUSTOM_FIELD_TYPES.join(", ")}.`);
  }
  return value as CustomFieldType;
}

function describe(field: CustomField): string {
  const options = field.options ? ` [${field.options.join(", ")}]` : "";
  return `${field.key} (${field.label}, ${field.type}${options})`;
}

export function registerCustomFieldCommands(program: Command): void {
  const types = CUSTOM_FIELD_TYPES.join(", ");

  program
    .command("add")
    .description("Add a custom field to every story")
    .requiredOption("--label <label>", "field name, e.g. Story Points")
    .requiredOption("--type <type>", `one of ${types}`, parseType)
    .option("--key <key>", "frontmatter key (default: the label in snake_case)")
    .option("--option <value>", "an allowed value of a select field (repeatable)", collect)
    .action((opts: { label: string; type: CustomFieldType; key?: string; option?: string[] }, command: Command) =>
      run(
        command,
        (ctx) => addCustomField({ label: opts.label, type: opts.type, key: opts.key, options: opts.option }, ctx),
        (field) => `Added custom field ${describe(field)}`,
      ),
    );

  program
    .command("update <key>")
    .description("Update a custom field")
    .option("--rename <key>", "new frontmatter key; renames it in every story")
    .option("--label <label>", "new name")
    .option("--type <type>", `new type, one of ${types}; existing values are converted`, parseType)
    .option("--option <value>", "replace the allowed values of a select field (repeatable)", collect)
    .action(
      (
        key: string,
        opts: { rename?: string; label?: string; type?: CustomFieldType; option?: string[] },
        command: Command,
      ) =>
        run(
          command,
          (ctx) =>
            updateCustomField(
              { key, newKey: opts.rename, label: opts.label, type: opts.type, options: opts.option },
              ctx,
            ),
          (field) => `Updated custom field ${describe(field)}`,
        ),
    );

  program
    .command("remove <key>")
    .description("Remove a custom field and its value from every story")
    .action((key: string, _opts: unknown, command: Command) =>
      run(
        command,
        (ctx) => removeCustomField({ key }, ctx),
        (field) => `Removed custom field ${field.key}`,
      ),
    );
}
