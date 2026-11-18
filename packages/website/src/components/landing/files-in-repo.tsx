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
  { depth: 1, name: "rowbly.config.json", note: "Stages, fields, factory settings" },
  { depth: 1, name: "stories/" },
  { depth: 2, name: "ROW-42.md", note: "one file per Story" },
  { depth: 1, name: "stages/" },
  { depth: 2, name: "IN_DEVELOPMENT.md", note: "the Stage prompt" },
  { depth: 1, name: "prompts/", note: "Project, Supervisor and Worker prompts" },
  { depth: 1, name: "specs/" },
  { depth: 1, name: "runtime/", note: "sessions and logs, not committed" },
];

const inlineCodeClass = "font-mono text-brand-text";

/** The "Files in your repo" section of the landing page. */
export function FilesInRepo() {
  return (
    <Section
      id="files"
      headline="Plain files in your repo"
      subhead={
        <>
          The board is Markdown and JSON in <code className={inlineCodeClass}>.rowbly/</code>. There is no server and no
          account.
        </>
      }
    >
      <div className="grid gap-10 lg:grid-cols-2 lg:items-start">
        <div className="flex max-w-prose flex-col gap-4 text-brand-muted">
          <p>
            Commit the board with your code. Diff it, branch it and review a change to a Stage prompt in a PR. Clone the
            repo and you have the board.
          </p>
          <p>
            Runtime data stays out of Git. <code className={inlineCodeClass}>.rowbly/runtime/</code> and{" "}
            <code className={inlineCodeClass}>state.json</code> hold the sessions, logs and process state of the
            factory. Rowbly adds them to <code className={inlineCodeClass}>.rowbly/.gitignore</code>.
          </p>
          <p>
            After a Git merge changes <code className={inlineCodeClass}>.rowbly/</code>, run{" "}
            <code className={inlineCodeClass}>rowbly doctor</code> to find problems and{" "}
            <code className={inlineCodeClass}>rowbly doctor --fix</code> to repair them.
          </p>
        </div>
        <TerminalFrame className="min-w-0">
          <ul
            aria-label="The .rowbly/ folder"
            className="flex flex-col gap-1 p-4 font-mono text-xs leading-5 sm:text-sm"
          >
            {TREE.map(({ depth, name, note }) => (
              <li
                key={`${depth}-${name}`}
                className="flex flex-wrap gap-x-3"
                style={{ paddingLeft: `${depth * 1.25}rem` }}
              >
                <span className={cn(name.startsWith("ROW-") ? "text-brand-story-key" : "text-brand-text")}>{name}</span>
                {note && <span className="text-brand-muted"># {note}</span>}
              </li>
            ))}
          </ul>
        </TerminalFrame>
      </div>
    </Section>
  );
}
