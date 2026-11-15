import { Box, type Key, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import { compactThreads, storyTimeZone } from "../../../../services/config/config.js";
import { getProject, type Project, updateProject } from "../../../../services/project/project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, DetailView, FormModal, type FormValues, Loading, Switch } from "../../../components/index.js";
import {
  type AsyncState,
  showToast,
  type ToastStore,
  useAsync,
  useIsActive,
  useKeyHints,
  useToast,
} from "../../../hooks/index.js";
import { systemTimeZone, theme } from "../../../theme.js";
import type { SettingsSectionProps } from "../settings-sections.js";

/** What a change of the display options reads and changes. */
interface DisplayEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly project: AsyncState<Project>;
  readonly on: boolean;
  readonly setEditing: Dispatch<SetStateAction<boolean>>;
  readonly onChange: () => void;
}

function toggleCompact(env: DisplayEnv): void {
  updateProject({ display: { compactThreads: !env.on } }, env.ctx).then(
    () => toggled(env),
    (err: unknown) => env.toast.error(err),
  );
}

function sectionKey(env: DisplayEnv, input: string, key: Key): void {
  if (input === " " || key.return) {
    toggleCompact(env);

    return;
  }

  if (input === "e") {
    env.setEditing(true);
  }
}

function toggled(env: DisplayEnv): void {
  showToast(env.toast, "info", `Compact Threads ${env.on ? "off" : "on"}`);
  reloaded(env);
}

function reloaded(env: DisplayEnv): void {
  env.project.reload();
  env.onChange();
}

/** Saves the time zone of the Story times. An empty value removes it, so that the system time zone applies. */
async function saveTimeZone(env: DisplayEnv, values: FormValues): Promise<void> {
  const timeZone = String(values.timeZone ?? "").trim();

  await updateProject({ display: { timeZone } }, env.ctx);

  showToast(env.toast, "info", timeZone === "" ? "Story times use the system time zone" : `Time zone ${timeZone}`);
  env.setEditing(false);
  reloaded(env);
}

/** The time zone as the section shows it: the saved zone, or the system zone. */
function timeZoneLabel(project: Project): string {
  const saved = storyTimeZone(project);

  return saved ?? `${systemTimeZone()} (system)`;
}

/**
 * The display options of the project. `space`, `enter` or a click on the Switch toggles the compact Threads. While
 * the compact Threads are on, each Thread in the Factory view and in the Threads tab of a Story uses one line. `e`
 * edits the time zone of the Story times in a Form.
 */
export function DisplaySection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const project = useAsync(() => getProject(ctx), [ctx]);

  const idle = active && !editing && project.data !== undefined;
  const on = project.data ? compactThreads(project.data) : true;

  const env: DisplayEnv = { ctx, toast, project, on, setEditing, onChange };

  useKeyHints(
    idle
      ? [
          { key: "space", description: on ? "compact off" : "compact on" },
          { key: "e", description: "edit time zone" },
        ]
      : [],
  );
  useInput((input, key) => sectionKey(env, input, key), { isActive: idle });

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
      <DetailView rows={[{ label: "Time zone", value: timeZoneLabel(project.data) }]} />
      <Text color={theme.inkFaint}>
        The Created and Updated times of a Story show in this time zone. Rowbly saves the times in UTC.
      </Text>
      <Box>
        <Button label="Edit time zone" keyName="e" onClick={() => setEditing(true)} clickable={idle} compact />
      </Box>
      {editing && (
        <FormModal
          title="Edit Time Zone"
          fields={[{ name: "timeZone", label: "Time zone", kind: "text" }]}
          initialValues={{ timeZone: storyTimeZone(project.data) ?? "" }}
          onSubmit={(values) => saveTimeZone(env, values)}
          onClose={() => setEditing(false)}
        />
      )}
    </Box>
  );
}
