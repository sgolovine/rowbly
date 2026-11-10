import { Text, useInput } from "ink";
import { useState } from "react";
import { forgetProject, type KnownProject, listKnownProjects } from "../../../services/knownProject/knownProject.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { ConfirmDialog, Loading, Modal, modalSize, SelectList } from "../../components/index.js";
import { useAsync, useEscape, useIsActive, useKeyCapture, useLayout, useToast } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/** The most columns a name takes in a row, so the path has room. */
const NAME_WIDTH = 24;

const cutEnd = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text);

/** Cuts from the start, because the end of a path names the project. */
const cutStart = (text: string, width: number) => (text.length > width ? `…${text.slice(1 - width)}` : text);

/**
 * The Project switcher, in a generic Modal. It lists the Projects in `~/.rowblyrc.json`, the most recent
 * first, and starts on the most recent Project that is not open. `↑/↓` select, `enter` or a click switches,
 * and `d` removes the selected Project from the list after a confirmation. The Project itself stays on disk.
 */
export function ProjectSwitcher({
  ctx,
  current,
  onSelect,
  onClose,
}: {
  ctx: ServiceContext;
  /** The root of the open Project, if there is one. */
  current?: string;
  onSelect(path: string): void;
  onClose(): void;
}) {
  const active = useIsActive();
  const toast = useToast();
  const { body } = modalSize(useLayout(), { footer: true });
  const projects = useAsync(() => listKnownProjects(ctx), [ctx]);
  const [highlighted, setHighlighted] = useState<string>();
  const [filtering, setFiltering] = useState(false);
  const [removing, setRemoving] = useState<KnownProject>();
  const idle = active && !removing;
  useKeyCapture(idle, { text: false, escape: true });
  useEscape(idle, onClose);

  const known = projects.data ?? [];
  const tagOf = (project: KnownProject) => {
    if (project.path === current) return <Text color={theme.accent}> · current</Text>;
    return project.missing ? <Text color={theme.danger}> · missing</Text> : undefined;
  };
  const items = known.map((project) => {
    const name = cutEnd(project.name, NAME_WIDTH);
    const tag = project.path === current ? " · current" : project.missing ? " · missing" : "";
    // The bar, the name, the tag and the space before the path take the other columns of the row.
    const room = body.width - 3 - name.length - tag.length;
    return {
      value: project.path,
      label: name,
      tag: tagOf(project),
      description: room >= 8 ? cutStart(project.path, room) : undefined,
    };
  });
  const pick = (path: string) => {
    const project = known.find((p) => p.path === path);
    if (project?.missing && path !== current) toast.push("warning", `${project.name} is no longer at ${path}`);
    else onSelect(path);
  };
  const highlightedProject = known.find((p) => p.path === highlighted);
  useInput(
    (input, key) => {
      if (input === "d" && !key.ctrl && !key.meta && highlightedProject) setRemoving(highlightedProject);
    },
    { isActive: idle && !filtering },
  );
  const remove = (project: KnownProject) => {
    forgetProject(project.path, ctx).then(
      () => {
        toast.push("info", `Removed ${project.name} from the list`);
        setRemoving(undefined);
        projects.reload();
      },
      (err: unknown) => {
        toast.error(err);
        setRemoving(undefined);
      },
    );
  };

  return (
    <Modal
      title="Projects"
      onClose={onClose}
      hints={[
        { key: "↑/↓", description: "select" },
        { key: "enter", description: "switch" },
        ...(highlightedProject ? [{ key: "d", description: "remove" }] : []),
        { key: "/", description: "filter" },
        { key: "esc", description: "close" },
      ]}
    >
      {projects.loading && !projects.data ? (
        <Loading label="Loading Projects…" />
      ) : (
        <SelectList
          items={items}
          defaultIndex={Math.max(
            0,
            known.findIndex((p) => p.path !== current && !p.missing),
          )}
          onSelect={(item) => pick(item.value)}
          onHighlight={(item) => setHighlighted(item?.value)}
          onFilteringChange={setFiltering}
          isActive={!removing}
          emptyText="No Projects yet. Run rowbly in a Project to add it here."
          limit={Math.max(1, Math.min(10, (body.height ?? 12) - 2))}
        />
      )}
      {removing && (
        <ConfirmDialog
          title={`Remove Project › ${removing.name}`}
          message={`Remove ${removing.name} from the list? Rowbly does not delete the files at ${removing.path}.`}
          confirmLabel="Remove"
          cancelLabel="Cancel"
          destructive
          onConfirm={() => remove(removing)}
          onCancel={() => setRemoving(undefined)}
        />
      )}
    </Modal>
  );
}
