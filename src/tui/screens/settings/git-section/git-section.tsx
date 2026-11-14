import { Box, Text } from "ink";
import type { FactorySettings } from "../../../../services/factory-settings/factory-settings.js";
import { FormModal, type FormValues } from "../../../components/index.js";
import { theme } from "../../../theme.js";
import { AiSettingCard } from "../ai-setting-card/index.js";
import type { SettingsSectionProps } from "../settings-sections.js";
import { type GitEnv, saveAuthor, saveInterval, saveMessage, toggleSync } from "./git-actions.js";
import { type GitTextKey, gitForm, gitTexts } from "./git-view.js";
import { useGitSection } from "./use-git-section.js";

/** The props of `GitTaskView`. */
interface GitTaskViewProps {
  readonly task: GitTextKey;
  readonly env: GitEnv;
  readonly settings: FactorySettings | undefined;
}

const SAVES: Readonly<Record<GitTextKey, (env: GitEnv, values: FormValues) => Promise<void>>> = {
  author: saveAuthor,
  message: saveMessage,
  interval: saveInterval,
};

/** The form of one value on top of the Git settings. */
function GitTaskView({ task, env, settings }: GitTaskViewProps) {
  const form = gitForm(task, settings);

  return (
    <FormModal
      title={form.title}
      fields={[form.field]}
      initialValues={{ [form.field.name]: form.initial }}
      submitOnEnter
      onSubmit={(values) => SAVES[task](env, values)}
      onClose={() => env.setTask(null)}
    >
      <Text color={theme.inkFaint} wrap="wrap">
        {form.note}
      </Text>
    </FormModal>
  );
}

/**
 * The Git settings of the factory: the author and the message of the canonical commits, and the periodic
 * push, pull and sync interval. `a`, `m` and `i` open a form; `p` and `u` toggle push and pull. An empty author
 * or message clears it. The section calls the `factory-settings` service and does not load Pi.
 */
export function GitSection({ ctx, onChange }: SettingsSectionProps) {
  const { env, task, idle } = useGitSection({ ctx, onChange });

  const settings = env.settings.data;
  const texts = gitTexts(settings);

  return (
    <Box flexDirection="column">
      <AiSettingCard
        title="Commit author"
        value={texts.author}
        description="The author of the commits that the factory makes in the canonical checkout."
        action="Edit"
        keyName="a"
        clickable={idle}
        onEdit={() => env.setTask("author")}
      />
      <AiSettingCard
        title="Commit message"
        value={texts.message}
        description="The message of the commits that the factory makes in the canonical checkout."
        action="Edit"
        keyName="m"
        clickable={idle}
        onEdit={() => env.setTask("message")}
      />
      <AiSettingCard
        title="Periodic push"
        value={texts.push}
        description="The factory pushes the canonical branch to its upstream at each sync."
        action="Toggle"
        keyName="p"
        clickable={idle}
        onEdit={() => toggleSync(env, "push")}
      />
      <AiSettingCard
        title="Periodic pull"
        value={texts.pull}
        description="The factory pulls the changes of the upstream into the canonical checkout at each sync."
        action="Toggle"
        keyName="u"
        clickable={idle}
        onEdit={() => toggleSync(env, "pull")}
      />
      <AiSettingCard
        title="Sync interval"
        value={texts.interval}
        description="The time between two syncs, when push or pull is on."
        action="Edit"
        keyName="i"
        clickable={idle}
        onEdit={() => env.setTask("interval")}
      />
      {task && <GitTaskView task={task} env={env} settings={settings} />}
    </Box>
  );
}
