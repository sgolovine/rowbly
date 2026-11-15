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

/** The "The factory" section of the "How it works" page: the supervisor and the workers. */
export function TheFactory() {
  return (
    <Section
      id="the-factory"
      headline="The factory"
      subhead="The supervisor does not write code. It reads the board, decides what is ready, and hands Stories to workers. Workers do the work."
    >
      <div className="grid gap-10 lg:grid-cols-[minmax(0,3fr)_minmax(0,2fr)] lg:items-start">
        <div className="flex max-w-prose flex-col gap-4 text-brand-muted">
          <p>
            Press <Kbd>f</Kbd> then <Kbd>s</Kbd> to start the factory. A supervisor agent looks at the board and picks
            the Stories that are ready for work. For each one, it starts a worker. Each worker gets one Story, its own
            branch and its own conversation. It reads the Stage prompt and does what the prompt says.
          </p>
          <p>
            You set the worker limit: how many workers can run at the same time. If you do not set it, the limit is
            four. When a worker finishes, the supervisor gives the free place to the next Story that is ready.
          </p>
          <p>
            The factory keeps running after you close the UI. Open <span className="font-mono">rowbly</span> again and
            the board shows where each Story is.
          </p>
          <p>The board works on any platform. The factory runs on Linux today.</p>
        </div>
        <FactoryDiagram />
      </div>
    </Section>
  );
}
