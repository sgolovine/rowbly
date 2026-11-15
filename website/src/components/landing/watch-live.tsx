import { Eye, Hand, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AgentTag } from "@/components/agent-tag";
import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

type ConversationLine = Readonly<{
  /** `tool`: a step of the agent, in muted text. `agent`: a message of the agent. */
  kind: "tool" | "agent";
  text: string;
}>;

/** The demo conversation of the Threads mock. The names and the Story are invented demo data. */
const CONVERSATION: readonly ConversationLine[] = [
  { kind: "tool", text: "read src/game/board.ts" },
  { kind: "tool", text: "read src/game/history.ts" },
  { kind: "agent", text: "The moves are in one list, so undo can drop the last move." },
  { kind: "agent", text: "Plan: add an undo action, keep the turn in sync, add tests." },
  { kind: "agent", text: "Question: in a two-player game, does undo take back one move or a full round?" },
];

const BANNER_TEXT = "Blocked: needs a design decision";

/** The index of the first character of each line in the full conversation. */
const LINE_STARTS = CONVERSATION.map((_, index) =>
  CONVERSATION.slice(0, index).reduce((total, line) => total + line.text.length, 0),
);
const TOTAL_CHARACTERS = CONVERSATION.reduce((total, line) => total + line.text.length, 0);

/** The timing of one loop: about 15 s. */
const CHARACTER_MS = 28;
const LINE_PAUSE_MS = 500;
const START_PAUSE_MS = 700;
const BANNER_HOLD_MS = 5000;

/** The time to wait before the next character, when `typed` characters show. */
function delayAfter(typed: number) {
  if (typed === 0) {
    return START_PAUSE_MS;
  }
  if (typed >= TOTAL_CHARACTERS) {
    return BANNER_HOLD_MS;
  }
  return LINE_STARTS.includes(typed) ? LINE_PAUSE_MS : CHARACTER_MS;
}

/**
 * The state of the typing loop. The server render and reduced motion show the final state: all lines and the banner.
 * The loop runs only when the mock is on screen, and pauses when it is off screen.
 */
function useTypingLoop() {
  const ref = useRef<HTMLDivElement>(null);
  const [typed, setTyped] = useState(TOTAL_CHARACTERS);
  const [onScreen, setOnScreen] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (
      !element ||
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      return;
    }

    setTyped(0);
    const observer = new IntersectionObserver(
      (entries) => {
        setOnScreen(entries.some((entry) => entry.isIntersecting));
      },
      { threshold: 0.25 },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      setOnScreen(false);
      setTyped(TOTAL_CHARACTERS);
    };
  }, []);

  useEffect(() => {
    if (!onScreen) {
      return;
    }
    const timer = window.setTimeout(() => {
      setTyped((current) => (current >= TOTAL_CHARACTERS ? 0 : current + 1));
    }, delayAfter(typed));
    return () => window.clearTimeout(timer);
  }, [onScreen, typed]);

  return { ref, typed };
}

/** The left pane: one Story card on the board, with its agent. */
function StoryPane() {
  return (
    <div className="border-b border-brand-border p-4 md:border-r md:border-b-0">
      <p className="mb-3 font-mono text-xs text-brand-muted">In Development</p>
      <div className="rounded-md border border-brand-border bg-brand-background p-3">
        <p className="font-mono text-xs text-brand-story-key">TTT-59</p>
        <p className="mt-1 text-sm text-brand-text">Add an undo button for two-player games</p>
        <AgentTag agent="claude-19" stage="In Development" className="mt-2" />
      </div>
    </div>
  );
}

type ThreadLineProps = Readonly<{
  line: ConversationLine;
  /** The number of characters of this line that show. */
  shown: number;
  /** The cursor is on this line. */
  active: boolean;
}>;

/** One line of the conversation. The text that is not typed yet keeps its space, so that the mock does not jump. */
function ThreadLine({ line, shown, active }: ThreadLineProps) {
  return (
    <p className={cn("font-mono text-xs leading-5", line.kind === "tool" ? "text-brand-muted" : "text-brand-text")}>
      <span
        className={cn("mr-2", line.kind === "tool" ? "text-brand-muted" : "text-brand-accent", !shown && "invisible")}
      >
        {line.kind === "tool" ? "›" : "●"}
      </span>
      {line.text.slice(0, shown)}
      {active && (
        <span className="relative">
          <span className="cursor-blink absolute top-0 left-0 text-brand-accent">▍</span>
        </span>
      )}
      <span className="invisible">{line.text.slice(shown)}</span>
    </p>
  );
}

/** The right pane: a Threads conversation that types out, then an Attention banner. */
function ThreadPane() {
  const { ref, typed } = useTypingLoop();
  const bannerVisible = typed >= TOTAL_CHARACTERS;

  return (
    <div ref={ref} className="flex min-w-0 flex-col p-4">
      <p className="mb-3 font-mono text-xs text-brand-muted">
        Threads <span aria-hidden="true">·</span> claude-19
      </p>
      <div aria-hidden="true" className="flex flex-col gap-1.5">
        {CONVERSATION.map((line, index) => {
          const start = LINE_STARTS[index] ?? 0;
          const shown = Math.min(Math.max(typed - start, 0), line.text.length);
          const active = typed >= start && typed < start + line.text.length;
          return <ThreadLine key={line.text} line={line} shown={shown} active={active} />;
        })}
      </div>
      <div className="sr-only">
        {CONVERSATION.map((line) => (
          <p key={line.text}>{line.text}</p>
        ))}
        <p>Attention. {BANNER_TEXT}</p>
      </div>
      <div
        aria-hidden="true"
        className={cn(
          "mt-4 flex items-center gap-2 rounded-md border border-brand-accent bg-brand-background px-3 py-2 font-mono text-xs motion-safe:transition-[opacity,translate] motion-safe:duration-500 motion-safe:ease-out",
          bannerVisible ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0",
        )}
      >
        <Hand className="size-3.5 shrink-0 text-brand-accent" />
        <span className="text-brand-accent">Attention</span>
        <span className="text-brand-text">{BANNER_TEXT}</span>
      </div>
    </div>
  );
}

const CHIPS = [
  { label: "Read", Icon: Eye },
  { label: "Interrupt", Icon: Pause },
  { label: "Resume", Icon: Play },
] as const;

/** The "Watch everything live" section of the landing page: a Story and its live Threads conversation. */
export function WatchLive() {
  return (
    <Section
      id="watch-live"
      headline="Never wonder what an agent is doing."
      subhead="Every Story shows which agent is on it. Open Threads to read any conversation as it happens. Interrupt it, give it a hint, resume it. When an agent is blocked, it raises its hand and shows up in Attention so you can unblock it and move on."
    >
      <TerminalFrame glow>
        <div className="grid grid-cols-1 md:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
          <StoryPane />
          <ThreadPane />
        </div>
      </TerminalFrame>
      <ul className="mt-6 flex flex-wrap gap-3">
        {CHIPS.map(({ label, Icon }) => (
          <li key={label}>
            <Badge variant="outline" className="px-3 py-1 text-sm">
              <Icon aria-hidden="true" />
              {label}
            </Badge>
          </li>
        ))}
      </ul>
    </Section>
  );
}
