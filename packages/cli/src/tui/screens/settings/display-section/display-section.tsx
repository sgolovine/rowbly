import { Box, type Key, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import {
  compactThreads,
  STORY_SIDEBAR_BEHAVIORS,
  type StorySidebarBehavior,
  storySidebarBehavior,
  storyTimeZone,
} from "../../../../services/config/config.js";
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
  readonly storySidebar: StorySidebarBehavior;
  readonly setEditing: Dispatch<SetStateAction<boolean>>;
  readonly onChange: () => void;
}

function toggleCompact(env: DisplayEnv): void {
  updateProject({ display: { compactThreads: !env.on } }, env.ctx).then(
    () => toggled(env),
    (err: unknown) => env.toast.error(err),
  );
}

/** The names of the Story sidebar options, as the section shows them. */
const STORY_SIDEBAR_LABELS: Readonly<Record<StorySidebarBehavior, string>> = {
  regular: "Regular",
  expanded: "Expanded",
  remember: "Remember last",
};

/** The Story sidebar option after `current`. The last option goes back to the first. */
function nextStorySidebar(current: StorySidebarBehavior): StorySidebarBehavior {
  const at = STORY_SIDEBAR_BEHAVIORS.indexOf(current);

  return STORY_SIDEBAR_BEHAVIORS[(at + 1) % STORY_SIDEBAR_BEHAVIORS.length] ?? "regular";
}

/** `w` or a click on the value: saves the next Story sidebar option, then the shell reads it. */
function cycleStorySidebar(env: DisplayEnv): void {
  const next = nextStorySidebar(env.storySidebar);

  updateProject({ display: { storySidebar: next } }, env.ctx).then(
    () => {
      showToast(env.toast, "info", `Story sidebar: ${STORY_SIDEBAR_LABELS[next]}`);
      reloaded(env);
    },
    (err: unknown) => env.toast.error(err),
  );
}

function sectionKey(env: DisplayEnv, input: string, key: Key): void {
  if (input === " " || key.return) {
    toggleCompact(env);

    return;
  }

  if (input === "w") {
    cycleStorySidebar(env);

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
 * edits the time zone of the Story times in a Form. `w` or a click on the value selects the next Story sidebar
 * option: how the Story sidebar opens.
 */
export function DisplaySection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const project = useAsync(() => getProject(ctx), [ctx]);

  const idle = active && !editing && project.data !== undefined;
  const on = project.data ? compactThreads(project.data) : true;
  const storySidebar = project.data ? storySidebarBehavior(project.data) : "regular";

  const env: DisplayEnv = { ctx, toast, project, on, storySidebar, setEditing, onChange };

  useKeyHints(
    idle
      ? [
          { key: "space", description: on ? "compact off" : "compact on" },
          { key: "e", description: "edit time zone" },
          { key: "w", description: "Story sidebar width" },
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
      <Box gap={2}>
        <Text color={theme.inkMuted}>Story sidebar</Text>
        <Button
          label={STORY_SIDEBAR_LABELS[storySidebar]}
          keyName="w"
          onClick={() => cycleStorySidebar(env)}
          clickable={idle}
          compact
        />
      </Box>
      <Text color={theme.inkFaint}>
        How the Story sidebar opens: at the regular width, expanded over the Story list, or in the last state that you
        selected while Rowbly runs. ctrl+o expands and collapses the open Story sidebar.
      </Text>
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
