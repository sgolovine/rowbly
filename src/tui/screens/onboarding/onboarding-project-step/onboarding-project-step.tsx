import { Box, Text } from "ink";
import { useCallback, useState } from "react";
import { toProjectKey } from "../../../../services/config/config.js";
import { planOnboarding } from "../../../../services/onboarding/onboarding.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Form, FormKeysContext, type FormValues } from "../../../components/index.js";
import { useEscape, useIsActive } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";

const BACK: KeyHint = { key: "esc", description: "back" };

/** The fields of the step. The key follows the name until the person changes it. */
function projectFields() {
  return [
    { name: "name", label: "Name", kind: "text" as const, required: true },
    {
      name: "key",
      label: "Key",
      kind: "text" as const,
      required: true,
      fillFrom: { field: "name", format: toProjectKey },
    },
  ];
}

/** Adds `esc` to the keys of the Form. The Form has nothing to undo, so the cleanup does nothing. */
function showStepKeys(onHints: (hints: readonly KeyHint[]) => void, keys: readonly KeyHint[]): () => void {
  onHints([...keys, BACK]);

  return () => {};
}

/** Checks the name and the key, then goes on. A ValidationError shows under its field. */
async function submitProject(
  ctx: ServiceContext,
  onNext: (name: string, key: string) => void,
  values: FormValues,
): Promise<void> {
  const next = { name: String(values.name ?? ""), key: String(values.key ?? "") };
  const plan = await planOnboarding(next, ctx);

  onNext(plan.name, plan.key);
}

/** The name and the key of the new Project, in a Form on the screen. */
export function OnboardingProjectStep({
  ctx,
  name,
  projectKey,
  onNext,
  onBack,
  onHints,
}: {
  ctx: ServiceContext;
  name: string;
  projectKey: string;
  onNext(name: string, key: string): void;
  onBack(): void;
  onHints(hints: readonly KeyHint[]): void;
}) {
  useEscape(useIsActive(), onBack);

  const showKeys = useCallback((keys: readonly KeyHint[]) => showStepKeys(onHints, keys), [onHints]);
  const [fields] = useState(projectFields);

  return (
    <Box flexDirection="column" gap={1}>
      <Box flexDirection="column">
        <Text bold color={theme.ink}>
          Project name and key
        </Text>
        <Text color={theme.inkFaint}>The key is the prefix of each Story ID.</Text>
      </Box>
      <FormKeysContext.Provider value={showKeys}>
        <Form
          fields={fields}
          initialValues={{ name, key: projectKey }}
          onSubmit={(values) => submitProject(ctx, onNext, values)}
          submitLabel="next"
          submitOnEnter
        />
      </FormKeysContext.Provider>
    </Box>
  );
}
