import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";
import { cn } from "@/lib/utils";

type TreeEntry = Readonly<{
  /** The depth of the entry. The `.rowbly/` folder has the depth 0. */
  depth: number;
  name: string;
  note?: string;
}>;

/** A simple `.rowbly/` folder. The names follow the real folder of a Rowbly Project. */
const TREE: readonly TreeEntry[] = [
  { depth: 0, name: ".rowbly/" },
  { depth: 1, name: "rowbly.config.json", note: "Stages and settings" },
  { depth: 1, name: "stories/" },
  { depth: 2, name: "ROW-42.md", note: "one file for each Story" },
  { depth: 1, name: "stages/" },
  { depth: 2, name: "IN_DEVELOPMENT.md", note: "the Stage prompt" },
  { depth: 1, name: "specs/" },
  { depth: 2, name: "undo-button.md" },
  { depth: 1, name: "attachments/" },
];

/** A `.rowbly/` file tree in a terminal frame. */
function FileTree() {
  return (
    <TerminalFrame className="min-w-0">
      <ul className="flex flex-col gap-1 p-4 font-mono text-xs leading-5 sm:text-sm">
        {TREE.map(({ depth, name, note }) => (
          <li key={`${depth}-${name}`} className="flex flex-wrap gap-x-3" style={{ paddingLeft: `${depth * 1.25}rem` }}>
            <span className={cn(name.startsWith("ROW-") ? "text-brand-story-key" : "text-brand-text")}>{name}</span>
            {note && <span className="text-brand-muted"># {note}</span>}
          </li>
        ))}
      </ul>
    </TerminalFrame>
  );
}

/** The "Files in your repo" section of the "How it works" page: the board is Markdown and JSON in `.rowbly/`. */
export function FilesInYourRepo() {
  return (
    <Section
      id="files-in-your-repo"
      headline="Files in your repo"
      subhead="The board is just files in your repo. No account, no sync, no vendor between you and your work."
    >
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="flex max-w-prose flex-col gap-4 text-brand-muted">
          <p>
            Your Stories, Stages, prompts and Specs are Markdown and JSON in a{" "}
            <code className="font-mono text-brand-text">.rowbly/</code> folder at the root of your repo.
          </p>
          <p>
            Commit them. Diff them. Review a change to a Stage prompt in a PR, like any other change. Clone the repo and
            the board comes with it.
          </p>
          <p>You do not need an account to use Rowbly.</p>
        </div>
        <FileTree />
      </div>
    </Section>
  );
}
