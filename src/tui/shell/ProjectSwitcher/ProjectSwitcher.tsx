import { Text } from "ink";
import { type KnownProject, listKnownProjects } from "../../../services/knownProject/knownProject.js";
import type { ServiceContext } from "../../../services/workspace/workspace.js";
import { Loading, Modal, modalSize, SelectList } from "../../components/index.js";
import { useAsync, useEscape, useIsActive, useKeyCapture, useLayout, useToast } from "../../hooks/index.js";
import { theme } from "../../theme.js";

/** The most columns a name takes in a row, so the path has room. */
const NAME_WIDTH = 24;

const cutEnd = (text: string, width: number) => (text.length > width ? `${text.slice(0, width - 1)}…` : text);

/** Cuts from the start, because the end of a path names the project. */
const cutStart = (text: string, width: number) => (text.length > width ? `…${text.slice(1 - width)}` : text);

/**
 * The Project switcher, in a generic Modal. It lists the Projects in `~/.rowblyrc.json`, the most recent
 * first, and starts on the most recent Project that is not open. `↑/↓` select, `enter` or a click switches.
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
  useKeyCapture(active, { text: false, escape: true });
  useEscape(active, onClose);

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

  return (
    <Modal
      title="Projects"
      onClose={onClose}
      hints={[
        { key: "↑/↓", description: "select" },
        { key: "enter", description: "switch" },
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
          emptyText="No Projects yet. Run rowbly in a Project to add it here."
          limit={Math.max(1, Math.min(10, (body.height ?? 12) - 2))}
        />
      )}
    </Modal>
  );
}
