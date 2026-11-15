import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";
import { Card } from "@/components/ui/card";

const FILE_TREE = [
  { name: ".rowbly/", depth: 0 },
  { name: "stories/", depth: 1 },
  { name: "stages/", depth: 1 },
  { name: "specs/", depth: 1 },
] as const;

/** The "It lives in your repo" section of the landing page. */
export function FilesInRepo() {
  return (
    <Section
      id="files"
      headline="The board is just files in your repo."
      subhead={
        <>
          Your Stories, Stages and Specs are Markdown and JSON in a{" "}
          <code className="font-mono text-brand-text">.rowbly/</code> folder. Commit them. Diff them. Branch them. Clone
          the repo and the board comes with it. No account, no sync, no vendor between you and your work.
        </>
      }
    >
      <div className="grid items-center gap-6 sm:grid-cols-2">
        <TerminalFrame className="min-w-0">
          <ul aria-label="The .rowbly/ folder" className="p-4 font-mono text-sm">
            {FILE_TREE.map((entry) => (
              <li key={entry.name} className={entry.depth === 0 ? "text-brand-text" : "pl-6 text-brand-muted"}>
                {entry.depth > 0 && <span aria-hidden="true">└ </span>}
                {entry.name}
              </li>
            ))}
          </ul>
        </TerminalFrame>
        <Card className="min-w-0 gap-2 px-5 py-5">
          <span className="font-mono text-xs text-brand-story-key">TTT-01</span>
          <p className="text-sm text-brand-text">Add an undo button for two-player games</p>
          <span className="font-mono text-xs text-brand-muted">Backlog</span>
        </Card>
      </div>
    </Section>
  );
}
