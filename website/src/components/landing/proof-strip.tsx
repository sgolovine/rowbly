import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";
import { Card } from "@/components/ui/card";
import { BoardShot } from "./board-shot";
import { CountUp } from "./count-up";

const STATS = [
  { value: 8, label: "In Refinement" },
  { value: 10, label: "In Development" },
  { value: 8, label: "In Review" },
  { value: 3, label: "model providers on one board", detail: "Claude, Codex, Gemini" },
] as const;

/** The proof strip: the stats of the real board below the Hero. */
export function ProofStrip() {
  return (
    <Section
      id="proof"
      headline="One board. Twenty-six agents. All at the same time."
      subhead="This is a real Rowbly board. Eight Stories being refined, ten being built, eight under review, each one with its own agent and its own branch. Nobody is waiting on anybody."
    >
      <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
        {STATS.map((stat) => (
          <li key={stat.label}>
            <Card className="h-full gap-2 px-5 py-5">
              <CountUp value={stat.value} className="font-mono text-4xl font-semibold text-brand-accent" />
              <p className="text-sm text-brand-text">{stat.label}</p>
              {"detail" in stat && <p className="text-xs text-brand-muted">{stat.detail}</p>}
            </Card>
          </li>
        ))}
      </ul>
      <figure className="mt-10">
        <TerminalFrame>
          <BoardShot mode="rings" />
        </TerminalFrame>
        <figcaption className="mt-3 text-center text-sm text-brand-muted">A real Rowbly board.</figcaption>
      </figure>
    </Section>
  );
}
