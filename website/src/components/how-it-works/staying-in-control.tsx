import { Hand } from "lucide-react";
import type { ReactNode } from "react";
import { AgentTag } from "@/components/agent-tag";
import { Kbd } from "@/components/kbd";
import { Section } from "@/components/section";
import { Card } from "@/components/ui/card";

type Control = Readonly<{
  title: string;
  visual: ReactNode;
  copy: ReactNode;
}>;

const CONTROLS: readonly Control[] = [
  {
    title: "The agent on each Story",
    visual: <AgentTag agent="claude-19" stage="In Development" />,
    copy: "When a worker is on a Story, the board shows the agent next to the Story. You always know who does what.",
  },
  {
    title: "Threads",
    visual: (
      <span className="flex flex-wrap items-center gap-1.5 text-xs text-brand-muted">
        <Kbd>t</Kbd> Threads <Kbd>x</Kbd> interrupt <Kbd>r</Kbd> resume
      </span>
    ),
    copy: (
      <>
        Press <Kbd>t</Kbd> to see the Threads. Open a Thread to read the conversation of its agent. Press <Kbd>x</Kbd>{" "}
        to interrupt it, and confirm. Press <Kbd>r</Kbd> to resume it.
      </>
    ),
  },
  {
    title: "Attention",
    visual: (
      <span className="inline-flex items-center gap-1.5 font-mono text-xs">
        <Hand aria-hidden="true" className="size-3.5 text-brand-accent" />
        <span className="text-brand-accent">Attention</span>
      </span>
    ),
    copy: (
      <>
        When something needs you, it shows up as an Attention item in the factory controls. Press <Kbd>f</Kbd> to see
        them.
      </>
    ),
  },
];

/** The "Staying in control" section of the "How it works" page: agent tags, Threads and Attention. */
export function StayingInControl() {
  return (
    <Section
      id="staying-in-control"
      headline="Staying in control"
      subhead="Agents do the work, and you see all of it. Nothing happens behind your back."
    >
      <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {CONTROLS.map((control) => (
          <li key={control.title} className="min-w-0">
            <Card className="h-full gap-3 px-5 py-5">
              <div className="flex min-h-6 items-center">{control.visual}</div>
              <h3 className="font-semibold text-brand-text">{control.title}</h3>
              <p className="text-sm text-brand-muted">{control.copy}</p>
            </Card>
          </li>
        ))}
      </ul>
      <blockquote className="mt-10 max-w-3xl border-l-2 border-brand-border pl-5">
        <p className="text-xl text-brand-text md:text-2xl">
          Interrupting an agent is not an emergency stop. It is a conversation. Say what you want, and resume.
        </p>
        <p className="mt-3 text-brand-muted">
          Interrupt the Thread. Change the Story or its Stage prompt so that it says what you want. Then resume the
          Thread, and the work continues with your change.
        </p>
      </blockquote>
    </Section>
  );
}
