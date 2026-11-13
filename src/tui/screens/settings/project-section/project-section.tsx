import { Box, Text, useInput } from "ink";
import { type Dispatch, type SetStateAction, useState } from "react";
import { getProject, type Project, updateProject } from "../../../../services/project/project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { Button, DetailView, FormModal, type FormValues, Loading } from "../../../components/index.js";
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

/** What a rename of the project reads and changes. */
interface RenameEnv {
  readonly ctx: ServiceContext;
  readonly toast: ToastStore;
  readonly project: AsyncState<Project>;
  readonly setEditing: Dispatch<SetStateAction<boolean>>;
  readonly onChange: () => void;
}

/** Renames the project, closes the Form and reads the project again. */
async function renameProject(env: RenameEnv, values: FormValues): Promise<void> {
  const saved = await updateProject({ name: String(values.name ?? "") }, env.ctx);

  showToast(env.toast, "info", `Renamed the project to ${saved.projectName}`);
  env.setEditing(false);
  env.project.reload();
  env.onChange();
}

function editKey(env: RenameEnv, input: string): void {
  if (input === "e") {
    env.setEditing(true);
  }
}

/**
 * The name and the key of the project. `e` edits the name in a Form. The key is the prefix of every
 * Story file, so it does not change here.
 */
export function ProjectSection({ ctx, onChange }: SettingsSectionProps) {
  const active = useIsActive();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const project = useAsync(() => getProject(ctx), [ctx]);

  const idle = active && !editing && project.data !== undefined;
  const env: RenameEnv = { ctx, toast, project, setEditing, onChange };

  useKeyHints(idle ? [{ key: "e", description: "edit name" }] : []);
  useInput((input) => editKey(env, input), { isActive: idle });

  if (!project.data) {
    return project.loading ? <Loading label="Loading the project…" /> : null;
  }

  return (
    <Box flexDirection="column" gap={1}>
      <DetailView
        rows={[
          { label: "Name", value: project.data.projectName },
          { label: "Key", value: project.data.projectKey },
          { label: "Folder", value: project.data.root },
        ]}
      />
      <Text color={theme.inkFaint}>The key is the prefix of each Story, for example {project.data.projectKey}-1.</Text>
      <Box>
        <Button label="Edit name" keyName="e" onClick={() => setEditing(true)} clickable={idle} compact />
      </Box>
      {editing && (
        <FormModal
          title="Edit Project"
          fields={[{ name: "name", label: "Name", kind: "text", required: true }]}
          initialValues={{ name: project.data.projectName }}
          onSubmit={(values) => renameProject(env, values)}
          onClose={() => setEditing(false)}
        />
      )}
    </Box>
  );
}
