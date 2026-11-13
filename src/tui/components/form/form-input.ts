import type { Key } from "ink";
import { isSubmitKey } from "../../keymap.js";
import { type FormEnv, moveFocus, setField, submitForm } from "./form-actions.js";
import { type FormField, type Raw, TYPED_KINDS } from "./form-values.js";

/** The keys of a `Form`: submit, move between fields, and change the focused field. */
export function handleFormKey(env: FormEnv, input: string, key: Key): void {
  if (env.busy) {
    return;
  }

  if (isSubmitKey(input, key)) {
    // A create host with tabs submits for all of its forms.
    if (!env.navigation) {
      void submitForm(env);
    }

    return;
  }

  if (key.tab) {
    tabKey(env, key);

    return;
  }

  if (!env.field) {
    submitRowKey(env, input, key);

    return;
  }

  fieldKey(env, env.field, input, key);
}

function tabKey(env: FormEnv, key: Key): void {
  // A create host with tabs uses `shift+tab` for the next tab.
  if (env.navigation && key.shift) {
    return;
  }

  moveFocus(env, key.shift ? -1 : 1);
}

/** The keys after the last field, where `enter` submits. */
function submitRowKey(env: FormEnv, input: string, key: Key): void {
  if (key.return) {
    void submitForm(env);

    return;
  }

  if (key.upArrow || input === "k") {
    moveFocus(env, -1);
  }
}

function fieldKey(env: FormEnv, field: FormField, input: string, key: Key): void {
  const raw = env.values[field.name] ?? null;
  const typed = TYPED_KINDS.includes(field.kind);

  // The TextArea handles its own `enter` and `↑/↓`, and calls back when they leave it.
  if (field.kind === "multiline") {
    return;
  }

  // The picker owns Enter and text; only Tab and vertical arrows leave this field.
  if (env.searchable && !key.upArrow && !key.downArrow) {
    return;
  }

  if (key.return && typed && env.submitOnEnter) {
    void submitForm(env);

    return;
  }

  if (key.return || key.downArrow || (!typed && input === "j")) {
    moveFocus(env, 1);

    return;
  }

  if (key.upArrow || (!typed && input === "k")) {
    moveFocus(env, -1);

    return;
  }

  editField(env, field, raw, input, key);
}

function editField(env: FormEnv, field: FormField, raw: Raw, input: string, key: Key): void {
  if (field.kind === "boolean" || field.kind === "switch") {
    toggleKey(env, field, raw, input, key);

    return;
  }

  if (field.kind === "select") {
    selectKey(env, field, raw, input, key);

    return;
  }

  if (field.kind === "multiselect") {
    multiselectKey(env, field, raw, input, key);
  }
}

function toggleKey(env: FormEnv, field: FormField, raw: Raw, input: string, key: Key): void {
  if (input === " " || ((key.leftArrow || key.rightArrow) && !key.shift)) {
    setField(env, field.name, raw !== true);
  }
}

/** The step of a select key: 1 for the next option, -1 for the previous option and 0 for no change. */
function selectStep(input: string, key: Key): number {
  // shift+←/→ is left to the screen (onboarding step navigation).
  const right = key.rightArrow && !key.shift;
  const left = key.leftArrow && !key.shift;

  if (right || input === "l" || input === " ") {
    return 1;
  }

  return left || input === "h" ? -1 : 0;
}

function selectKey(env: FormEnv, field: FormField, raw: Raw, input: string, key: Key): void {
  const options = field.options ?? [];
  const step = selectStep(input, key);
  const at = typeof raw === "string" ? options.indexOf(raw) : -1;

  if (step && options.length > 0) {
    setField(env, field.name, options[(at + step + options.length) % options.length] ?? null);
  }
}

function multiselectKey(env: FormEnv, field: FormField, raw: Raw, input: string, key: Key): void {
  const options = field.options ?? [];

  if (key.rightArrow || input === "l") {
    env.setOptionCursor((cursor) => Math.min(options.length - 1, cursor + 1));

    return;
  }

  if (key.leftArrow || input === "h") {
    env.setOptionCursor((cursor) => Math.max(0, cursor - 1));

    return;
  }

  if (input === " ") {
    toggleOption(env, field, raw, options[env.optionCursor]);
  }
}

function toggleOption(env: FormEnv, field: FormField, raw: Raw, option: string | undefined): void {
  const current = Array.isArray(raw) ? raw : [];

  if (option !== undefined) {
    setField(env, field.name, current.includes(option) ? current.filter((o) => o !== option) : [...current, option]);
  }
}
