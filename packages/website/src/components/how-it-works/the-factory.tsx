import { Kbd } from "@/components/kbd";
import { Section } from "@/components/section";

/** A drawing of a supervisor that hands Stories to workers. The supervisor pulses slowly when motion is allowed. */
function FactoryDiagram() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 240 160"
      className="h-auto w-full max-w-sm rounded-lg border border-brand-border bg-brand-surface p-4"
      fill="none"
    >
      <rect
        x="80"
        y="10"
        width="80"
        height="32"
        rx="5"
        className="stroke-brand-accent motion-safe:animate-ring-pulse"
        strokeWidth="1.5"
      />
      <text x="120" y="30" textAnchor="middle" className="fill-brand-text font-mono text-[10px]">
        supervisor
      </text>
      <path d="M120 42v18M40 60h160M40 60v18M120 60v18M200 60v18" className="stroke-brand-border" strokeWidth="1.5" />
      {[
        { x: 8, key: "ROW-41" },
        { x: 88, key: "ROW-42" },
        { x: 168, key: "ROW-43" },
      ].map(({ x, key }) => (
        <g key={key}>
          <rect x={x} y="78" width="64" height="32" rx="5" className="stroke-brand-muted" strokeWidth="1.5" />
          <text x={x + 32} y="98" textAnchor="middle" className="fill-brand-muted font-mono text-[10px]">
            worker
          </text>
          <text x={x + 32} y="134" textAnchor="middle" className="fill-brand-story-key font-mono text-[10px]">
            {key}
          </text>
          <path d={`M${x + 32} 110v12`} className="stroke-brand-border" strokeWidth="1.5" />
        </g>
      ))}
    </svg>
  );
}

const inlineCodeClass = "font-mono text-brand-text";

/** The "The factory" section of the "How it works" page: the daemon, the supervisor and the workers. */
export function TheFactory() {
  return (
    <Section
      id="the-factory"
      headline="The factory"
      subhead="One supervisor session decides which Stories get work. Up to your worker limit, worker sessions do the work. The supervisor does not write code."
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex max-w-prose flex-col gap-4 text-brand-muted">
          <p>
            <code className={inlineCodeClass}>rowbly factory start</code> (or <Kbd>f</Kbd> then <Kbd>s</Kbd> in the TUI)
            starts a detached daemon under a watchdog. If the daemon crashes, the watchdog starts it again. Close the
            TUI and the factory keeps running. <code className={inlineCodeClass}>--foreground</code> runs it in the
            current terminal instead.
          </p>
          <p>
            The supervisor only has factory tools: read the board, start or stop a worker, inspect a worker, raise an
            attention item. It gets short summaries of the workers, not their transcripts.
          </p>
          <p>
            Each worker gets one Story in one Stage, a Git worktree on the branch of the Story and its own session. It
            changes the board only through the Rowbly CLI, under a write lock. The default worker limit is 4. You can
            set a different worker model for each Stage or each Story.
          </p>
          <p>
            Press <Kbd>t</Kbd> to list the Threads. Open one to read the session as it runs. <Kbd>x</Kbd> interrupts it,
            and <Kbd>r</Kbd> resumes it. When a worker needs a decision, it shows up under Attention in the factory
            controls.
          </p>
        </div>
        <FactoryDiagram />
      </div>
    </Section>
  );
}
