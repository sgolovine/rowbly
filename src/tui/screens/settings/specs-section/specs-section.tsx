import { Box, type Key, Text, useInput } from "ink";
import { getProject, type Project, updateProject } from "../../../../services/project/project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Loading, Switch } from "../../../components/index.js";
import {
  type AsyncState,
  showToast,
  type ToastStore,
  useAsync,
  useIsActive,
  useKeyHints,
  useToast,
} from "../../../hooks/index.js";
import { theme } from "../../../theme.js";
import type { SettingsSectionProps } from "../settings-sections.js";

/** What a toggle of Specs reads and changes. */
interface SpecsEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly project: AsyncState<Project>;
  readonly on: boolean;
  readonly onChange: () => void;
}

function toggleSpecs(env: SpecsEnv): void {
  updateProject({ features: { specs: !env.on } }, env.ctx).then(
    () => toggled(env),
    (err: unknown) => env.toast.error(err),
  );
}

function toggleKey(env: SpecsEnv, input: string, key: Key): void {
  if (input === " " || key.return) {
    toggleSpecs(env);
  }
}

function toggled(env: SpecsEnv): void {
  showToast(env.toast, "info", `Specs ${env.on ? "off" : "on"}`);
  env.project.reload();
  env.onChange();
}

/**
 * Turns Specs on or off for the project. `space`, `enter` or a click on the Switch toggles it. While Specs
 * are on, an open Story has a Specs tab.
 */
export function SpecsSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const project = useAsync(() => getProject(ctx), [ctx]);

  const idle = active && project.data !== undefined;
  const on = project.data?.features?.specs === true;

  const env: SpecsEnv = { ctx, toast, project, on, onChange };

  useKeyHints(idle ? [{ key: "space", description: on ? "turn off" : "turn on" }] : []);
  useInput((input, key) => toggleKey(env, input, key), { isActive: idle });

  if (!project.data) {
    return project.loading ? <Loading label="Loading the project…" /> : null;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text color={theme.inkMuted}>Specs</Text>
        <Switch on={on} onLabel="Enabled" offLabel="Disabled" onChange={() => toggleSpecs(env)} clickable={idle} />
      </Box>
      <Text color={theme.inkFaint}>
        A spec is a Markdown document in .rowbly/specs/, linked to one or more Stories. While Specs are on, an open
        Story has a Specs tab.
      </Text>
    </Box>
  );
}
