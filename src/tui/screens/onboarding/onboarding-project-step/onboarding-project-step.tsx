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
  const showKeys = useCallback(
    (keys: readonly KeyHint[]) => {
      onHints([...keys, BACK]);
      return () => {};
    },
    [onHints],
  );
  const [fields] = useState(() => [
    { name: "name", label: "Name", kind: "text" as const, required: true },
    {
      name: "key",
      label: "Key",
      kind: "text" as const,
      required: true,
      fillFrom: { field: "name", format: toProjectKey },
    },
  ]);
  const submit = async (values: FormValues) => {
    const next = { name: String(values.name ?? ""), key: String(values.key ?? "") };
    // A ValidationError shows under its field.
    const plan = await planOnboarding(next, ctx);
    onNext(plan.name, plan.key);
  };
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
          onSubmit={submit}
          submitLabel="next"
          submitOnEnter
        />
      </FormKeysContext.Provider>
    </Box>
  );
}
