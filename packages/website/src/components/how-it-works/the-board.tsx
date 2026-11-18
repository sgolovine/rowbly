import { AnimatedBoard } from "@/components/landing/animated-board";
import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";

/** The "The board" section of the "How it works" page: Stories, Stages and Story keys. */
export function TheBoard() {
  return (
    <Section
      id="the-board"
      headline="The board"
      subhead="A Kanban board in your terminal. Each card is a Story. Each column is a Stage."
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <div className="flex max-w-prose flex-col gap-4 text-brand-muted">
          <p>
            A <strong className="font-semibold text-brand-text">Story</strong> is one piece of work, stored as one
            Markdown file. One sentence is enough to start. New Stories go to Backlog.
          </p>
          <p>
            Each Story has a key, for example <span className="font-mono text-brand-story-key">ROW-42</span>. The key
            does not change when the Story moves. A worker on that Story works on the branch{" "}
            <span className="font-mono text-brand-text">story/ROW-42</span>.
          </p>
          <p>
            A <strong className="font-semibold text-brand-text">Stage</strong> is a column, for example In Refinement,
            In Development or In Review. The position of a Story on the board tells you where the work is.
          </p>
          <p>
            A <strong className="font-semibold text-brand-text">Spec</strong> is a Markdown document that you link to
            one or more Stories. Workers read it with the Story. You can also attach images to a Story.
          </p>
        </div>
        <TerminalFrame className="min-w-0">
          <AnimatedBoard />
        </TerminalFrame>
      </div>
    </Section>
  );
}
