import { Box, type Key, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import {
  applyOnboarding,
  type OnboardingInput,
  type OnboardingPlan,
  planOnboarding,
  summarizePlan,
} from "../../../../services/onboarding/onboarding.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, DetailView, Loading, ScrollBody } from "../../../components/index.js";
import {
  showToast,
  type ToastStore,
  useAsync,
  useIsActive,
  useLayout,
  useReportHints,
  useToast,
} from "../../../hooks/index.js";
import type { KeyHint } from "../../../keymap.js";
import { theme } from "../../../theme.js";

const HINTS: readonly KeyHint[] = [
  { key: "enter", description: "create Project" },
  { key: "esc", description: "back" },
];

/** The rows that the Button below the summary takes. */
const BUTTON_ROWS = 2;

/** What the summary reads and changes. */
interface SummaryEnv {
  readonly ctx: ServiceContext;
  readonly input: OnboardingInput;
  readonly plan: OnboardingPlan | undefined;
  readonly busy: boolean;
  readonly toast: ToastStore;
  readonly setBusy: Dispatch<SetStateAction<boolean>>;
  readonly onBack: () => void;
  readonly onCreated: () => void;
}

/** Creates the Project once the plan is ready. A failure lets the person try again. */
async function createProject(env: SummaryEnv): Promise<void> {
  if (env.busy || !env.plan) {
    return;
  }

  env.setBusy(true);

  try {
    const project = await applyOnboarding(env.input, env.ctx);

    showToast(env.toast, "info", `Created ${project.projectName} (${project.projectKey})`);
    env.onCreated();
  } catch (err) {
    env.toast.error(err);
    env.setBusy(false);
  }
}

function handleSummaryKey(env: SummaryEnv, key: Key): void {
  if (key.return) {
    void createProject(env);

    return;
  }

  if (key.escape && !env.busy) {
    env.onBack();
  }
}

/** The rows of the summary above the Button, or all rows when the height is not known. */
function scrollHeight(height: number | undefined): number | undefined {
  return height === undefined ? undefined : Math.max(3, height - BUTTON_ROWS);
}

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

  const env: SummaryEnv = { ctx, input, plan: plan.data, busy, toast, setBusy, onBack, onCreated };

  useReportHints(onHints, HINTS);
  useInput((_input, key) => handleSummaryKey(env, key), { isActive: active });

  if (!plan.data) {
    return plan.loading ? <Loading label="Preparing the summary…" /> : null;
  }

  return (
    <Box flexDirection="column" flexGrow={1}>
      <ScrollBody height={scrollHeight(layout.height)}>
        <Text bold color={theme.ink}>
          Summary
        </Text>
        <DetailView rows={summarizePlan(plan.data)} />
        {plan.data.warnings.map((warning) => (
          <Box key={warning} marginTop={1}>
            <Text color={theme.danger}>Warning: {warning}</Text>
          </Box>
        ))}
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
          onClick={() => void createProject(env)}
          clickable={active}
          compact
          primary
          busy={busy}
        />
      </Box>
    </Box>
  );
}
