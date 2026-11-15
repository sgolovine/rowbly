import { cn } from "@/lib/utils";

type AgentTagProps = Readonly<{
  /** The agent name, for example `claude-19`. */
  agent: string;
  /** The Stage label, for example `In Refinement`. */
  stage: string;
  className?: string;
}>;

/** A mono tag that shows an agent and its live Stage, as on the board of the TUI. */
export function AgentTag({ agent, stage, className }: AgentTagProps) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 font-mono text-xs", className)}>
      <span className="text-brand-muted">▸ {agent}</span>
      <span aria-hidden="true" className="text-brand-accent">
        •
      </span>
      <span className="text-brand-accent">{stage}</span>
    </span>
  );
}
