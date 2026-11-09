import { toProjectKey } from "../../../../services/config/config.js";
import { defaultProjectName, initProject, type Project } from "../../../../services/project/project.js";
import type { ServiceContext } from "../../../../services/workspace/workspace.js";
import { FormModal, type FormValues } from "../../../components/index.js";
import { useToast } from "../../../hooks/index.js";

/**
 * Creates a Project in the directory of `ctx`, like `rowbly init`. The name starts as the name of the
 * directory, and the key fills from the name until you type your own.
 */
export function NewProjectModal({
  ctx,
  onCreated,
  onClose,
}: {
  ctx: ServiceContext;
  onCreated(project: Project): void;
  onClose(): void;
}) {
  const toast = useToast();
  const submit = async (values: FormValues) => {
    const project = await initProject({ name: String(values.name ?? ""), key: String(values.key ?? "") }, ctx);
    toast.push("info", `Created ${project.projectName} (${project.projectKey})`);
    onCreated(project);
  };
  return (
    <FormModal
      title="New Project"
      fields={[
        { name: "name", label: "Name", kind: "text", required: true },
        { name: "key", label: "Key", kind: "text", required: true, fillFrom: { field: "name", format: toProjectKey } },
      ]}
      initialValues={{ name: defaultProjectName(ctx), key: "" }}
      onSubmit={submit}
      onClose={onClose}
    />
  );
}
