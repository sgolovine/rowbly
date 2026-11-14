import { Box, type Key, Text, useInput } from "ink";
import { compactThreads } from "../../../../services/config/config.js";
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

/** What a toggle of the compact Threads reads and changes. */
interface DisplayEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly project: AsyncState<Project>;
  readonly on: boolean;
  readonly onChange: () => void;
}

function toggleCompact(env: DisplayEnv): void {
  updateProject({ display: { compactThreads: !env.on } }, env.ctx).then(
    () => toggled(env),
    (err: unknown) => env.toast.error(err),
  );
}

function toggleKey(env: DisplayEnv, input: string, key: Key): void {
  if (input === " " || key.return) {
    toggleCompact(env);
  }
}

function toggled(env: DisplayEnv): void {
  showToast(env.toast, "info", `Compact Threads ${env.on ? "off" : "on"}`);
  env.project.reload();
  env.onChange();
}

/**
 * Turns the compact Threads on or off for the project. `space`, `enter` or a click on the Switch toggles it. While
 * the compact Threads are on, each Thread in the Factory view and in the Threads tab of a Story uses one line.
 */
export function DisplaySection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const project = useAsync(() => getProject(ctx), [ctx]);

  const idle = active && project.data !== undefined;
  const on = project.data ? compactThreads(project.data) : true;

  const env: DisplayEnv = { ctx, toast, project, on, onChange };

  useKeyHints(idle ? [{ key: "space", description: on ? "turn off" : "turn on" }] : []);
  useInput((input, key) => toggleKey(env, input, key), { isActive: idle });

  if (!project.data) {
    return project.loading ? <Loading label="Loading the project…" /> : null;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <Box gap={2}>
        <Text color={theme.inkMuted}>Compact Threads</Text>
        <Switch on={on} onLabel="Enabled" offLabel="Disabled" onChange={() => toggleCompact(env)} clickable={idle} />
      </Box>
      <Text color={theme.inkFaint}>
        While compact Threads are on, each Thread in the Threads view and in the Threads tab of a Story uses one line.
        The Thread details show the model, the time and the result.
      </Text>
    </Box>
  );
}
