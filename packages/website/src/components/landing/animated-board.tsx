import { Pause, Play } from "lucide-react";
import { type CSSProperties, useEffect, useRef, useState } from "react";
import { AgentTag } from "@/components/agent-tag";
import {
  advanceBoard,
  BOARD_CARDS,
  BOARD_COLUMNS,
  BOARD_SLOTS,
  type BoardCard,
  type CardPlace,
  INITIAL_BOARD,
  isWorkingColumn,
} from "@/components/landing/board-loop";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** The time between two moves, in milliseconds. */
const MOVE_DELAY = 2000;
/** The height of one card slot, in pixels. */
const SLOT_HEIGHT = 112;
/** The space between two card slots, in pixels. */
const SLOT_GAP = 8;
/** The fixed height of the card area. The loop never changes it, so the section has no layout shift. */
const CARD_AREA_HEIGHT = BOARD_SLOTS * SLOT_HEIGHT + (BOARD_SLOTS - 1) * SLOT_GAP;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

/**
 * An animated Rowbly board. One card moves one column to the right about every 2 s. The first render
 * is a static board with cards in all five columns. The loop starts after mount only if the user
 * allows motion, and it stops when the board is off screen, when the tab is hidden or when the user
 * presses Pause.
 */
export function AnimatedBoard() {
  const boardRef = useRef<HTMLDivElement>(null);
  const [board, setBoard] = useState(INITIAL_BOARD);
  const [motionAllowed, setMotionAllowed] = useState(false);
  const [onScreen, setOnScreen] = useState(false);
  const [tabVisible, setTabVisible] = useState(true);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const update = () => {
      setMotionAllowed(!query.matches);
      if (query.matches) {
        setBoard(INITIAL_BOARD);
      }
    };
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    const element = boardRef.current;
    if (!motionAllowed || element === null) {
      return;
    }
    const observer = new IntersectionObserver((entries) => {
      const entry = entries[entries.length - 1];
      if (entry !== undefined) {
        setOnScreen(entry.isIntersecting);
      }
    });
    observer.observe(element);
    const updateTab = () => setTabVisible(!document.hidden);
    updateTab();
    document.addEventListener("visibilitychange", updateTab);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", updateTab);
    };
  }, [motionAllowed]);

  const running = motionAllowed && onScreen && tabVisible && !paused;

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = window.setInterval(() => setBoard(advanceBoard), MOVE_DELAY);
    return () => window.clearInterval(timer);
  }, [running]);

  return (
    <div ref={boardRef}>
      <div className="overflow-x-auto">
        <TooltipProvider>
          {/* biome-ignore lint/a11y/useSemanticElements: a fieldset is for form controls, and this group is a board. */}
          <div
            role="group"
            aria-label="An animated Rowbly board. Stories move from Backlog to Done, and an agent works on each Story in Refinement, Development and Review."
            className="min-w-[800px] p-3"
          >
            <div className="grid grid-cols-5">
              {BOARD_COLUMNS.map((column) => (
                <div key={column.label} className="px-1.5 pb-3">
                  <ColumnHeader label={column.label} prompt={column.prompt} />
                </div>
              ))}
            </div>
            <div className="relative" style={{ height: CARD_AREA_HEIGHT }}>
              <div aria-hidden="true" className="absolute inset-0 grid grid-cols-5">
                {BOARD_COLUMNS.map((column) => (
                  <div key={column.label} className="border-l border-brand-border first:border-l-0" />
                ))}
              </div>
              <div aria-hidden="true" className="absolute inset-0">
                {board.leaving !== null && (
                  <BoardCardView
                    key={`${board.step}-leaving`}
                    card={BOARD_CARDS[board.leaving.index]}
                    place={board.leaving.place}
                    phase="leaving"
                  />
                )}
                {board.places.map((place, index) => {
                  const card = BOARD_CARDS[index];
                  return (
                    <BoardCardView
                      key={`${card?.storyKey}-${place.lap}`}
                      card={card}
                      place={place}
                      phase={place.lap > 0 && place.column === 0 ? "entering" : "placed"}
                    />
                  );
                })}
              </div>
            </div>
          </div>
        </TooltipProvider>
      </div>
      <div className="flex h-10 items-center justify-end border-t border-brand-border px-3">
        {motionAllowed && (
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="font-mono text-brand-muted hover:text-brand-text"
            aria-label={paused ? "Play the board animation" : "Pause the board animation"}
            onClick={() => setPaused((value) => !value)}
          >
            {paused ? <Play aria-hidden="true" /> : <Pause aria-hidden="true" />}
            {paused ? "Play" : "Pause"}
          </Button>
        )}
      </div>
    </div>
  );
}

type ColumnHeaderProps = Readonly<{
  label: string;
  prompt?: string;
}>;

/** A column label. A working column label is a button that shows the Stage prompt in a tooltip. */
function ColumnHeader({ label, prompt }: ColumnHeaderProps) {
  if (prompt === undefined) {
    return <span className="font-mono text-xs text-brand-muted">{label}</span>;
  }
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="cursor-help rounded-sm font-mono text-xs text-brand-text underline decoration-brand-muted decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-brand-accent"
        >
          {label}
        </button>
      </TooltipTrigger>
      <TooltipContent
        side="bottom"
        className="max-w-60 font-mono motion-reduce:animate-none motion-reduce:data-[state=closed]:animate-none"
      >
        {prompt}
      </TooltipContent>
    </Tooltip>
  );
}

type BoardCardViewProps = Readonly<{
  card: BoardCard | undefined;
  place: CardPlace;
  /** `entering` fades the card in, in Backlog. `leaving` fades the card out, in Done. */
  phase: "placed" | "entering" | "leaving";
}>;

/** One card. Its position is a CSS transform, so that a move needs no layout. */
function BoardCardView({ card, place, phase }: BoardCardViewProps) {
  if (card === undefined) {
    return null;
  }
  const working = isWorkingColumn(place.column);
  const stage = BOARD_COLUMNS[place.column]?.label ?? "";
  const style: CSSProperties = {
    height: SLOT_HEIGHT,
    transform: `translate(${place.column * 100}%, ${place.slot * (SLOT_HEIGHT + SLOT_GAP)}px)`,
  };
  return (
    <div
      style={style}
      className={cn(
        "absolute top-0 left-0 w-1/5 px-1.5 motion-safe:transition-transform motion-safe:duration-600 motion-safe:ease-out",
        phase === "entering" && "board-card-enter",
        phase === "leaving" && "board-card-leave",
      )}
    >
      <div className="flex h-full flex-col rounded-md border border-brand-border bg-brand-background p-2">
        <span className="font-mono text-xs text-brand-story-key">{card.storyKey}</span>
        <span className="mt-1 line-clamp-2 text-xs text-brand-text">{card.title}</span>
        {working && (
          <span className="mt-auto flex items-end">
            <AgentTag agent={card.agent} stage={stage} className="flex-wrap gap-x-1.5 gap-y-0" />
            <span className="cursor-blink font-mono text-xs text-brand-accent">_</span>
          </span>
        )}
      </div>
    </div>
  );
}
