import { Box, Text, useInput } from "ink";
import { useState } from "react";
import {
  applyOnboarding,
  type OnboardingInput,
  planOnboarding,
  summarizePlan,
} from "../../../../services/onboarding/onboarding.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, DetailView, Loading, ScrollBody } from "../../../components/index.js";
import { useAsync, useIsActive, useLayout, useToast } from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";
import { useStepHints } from "../useStepHints.js";

const HINTS: readonly KeyHint[] = [
  { key: "enter", description: "create Project" },
  { key: "esc", description: "back" },
];

/** The rows that the Button below the summary takes. */
const BUTTON_ROWS = 2;

/** The last step of onboarding: what Rowbly will create, and where to edit it later. `enter` creates it. */
export function OnboardingSummary({
  ctx,
  input,
  onBack,
  onCreated,
  onHints,
}: {
  ctx: ServiceContext;
  input: OnboardingInput;
  onBack(): void;
  onCreated(): void;
  onHints(hints: readonly KeyHint[]): void;
}) {
  const active = useIsActive();
  const layout = useLayout();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const plan = useAsync(() => planOnboarding(input, ctx), [ctx, JSON.stringify(input)]);
  useStepHints(onHints, HINTS);

  const create = async () => {
    if (busy || !plan.data) return;
    setBusy(true);
    try {
      const project = await applyOnboarding(input, ctx);
      toast.push("info", `Created ${project.projectName} (${project.projectKey})`);
      onCreated();
    } catch (err) {
      toast.error(err);
      setBusy(false);
    }
  };

  useInput(
    (_input, key) => {
      if (key.return) void create();
      else if (key.escape && !busy) onBack();
    },
    { isActive: active },
  );

  if (!plan.data) return plan.loading ? <Loading label="Preparing the summary…" /> : null;
  return (
    <Box flexDirection="column" flexGrow={1}>
      <ScrollBody height={layout.height === undefined ? undefined : Math.max(3, layout.height - BUTTON_ROWS)}>
        <Text bold color={theme.ink}>
          Summary
        </Text>
        <DetailView rows={summarizePlan(plan.data)} />
        <Box marginTop={1}>
          <Text bold color={theme.ink}>
            Where to edit this later
          </Text>
        </Box>
        <DetailView rows={plan.data.edits.map(({ what, where }) => ({ label: what, value: where }))} />
      </ScrollBody>
      <Box marginTop={1}>
        <Button
          label={busy ? "Creating…" : "Create Project"}
          keyName="enter"
          onClick={() => void create()}
          clickable={active}
          compact
          primary
          busy={busy}
        />
      </Box>
    </Box>
  );
}
