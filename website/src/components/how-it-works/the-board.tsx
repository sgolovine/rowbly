import { AnimatedBoard } from "@/components/landing/animated-board";
import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";

/** The "The board" section of the "How it works" page: Stories, Stages and Story keys. */
export function TheBoard() {
  return (
    <Section
      id="the-board"
      headline="The board"
      subhead="Everything starts on a Kanban board in your terminal. Each card is a Story. Each column is a Stage."
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] lg:items-start">
        <div className="flex max-w-prose flex-col gap-4 text-brand-muted">
          <p>
            A <strong className="font-semibold text-brand-text">Story</strong> is one piece of work. One sentence is
            enough to start: &ldquo;Add an undo button for two-player games.&rdquo; New Stories land in Backlog.
          </p>
          <p>
            Each Story has a key, for example <span className="font-mono text-brand-story-key">ROW-42</span>. The key
            stays the same while the Story moves from Stage to Stage, so you and the agents always talk about the same
            thing.
          </p>
          <p>
            A <strong className="font-semibold text-brand-text">Stage</strong> is a column, for example In Refinement,
            In Development or In Review. The position of a Story on the board tells you where the work is.
          </p>
          <p>
            You can add context when it helps. Link a Markdown{" "}
            <strong className="font-semibold text-brand-text">Spec</strong> to a Story so agents build what you meant,
            or attach a screenshot. Both are optional.
          </p>
        </div>
        <TerminalFrame className="min-w-0">
          <AnimatedBoard />
        </TerminalFrame>
      </div>
    </Section>
  );
}
