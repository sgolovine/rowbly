import { cn } from "@/lib/utils";

/**
 * The crop box of `board.png` and `board-no-tags.png` in `assets/screenshot.png`.
 * All other values in this file are pixel positions in the original screenshot.
 * The page loads the lossless WebP copies (`board.webp` and `board-no-tags.webp`), because they are much smaller.
 */
const CROP = { left: 261, top: 130, right: 1612, bottom: 748 } as const;
const CROP_WIDTH = CROP.right - CROP.left;
const CROP_HEIGHT = CROP.bottom - CROP.top;

/** The column of agent tags that `board-no-tags.png` does not have. */
const TAG_COLUMN = { left: 1290, right: 1600 } as const;
const ROW_HEIGHT = 19;

/** The top of the first Story row of each Stage group and the number of rows in the group. */
const TAG_GROUPS = [
  { top: 186, rows: 8 },
  { top: 357, rows: 10 },
  { top: 566, rows: 8 },
] as const;

const TAG_ROW_TOPS = TAG_GROUPS.flatMap(({ top, rows }) =>
  Array.from({ length: rows }, (_, index) => top + index * ROW_HEIGHT),
);

/** The delay between the fade-in of two tags. 26 tags take about 1.5 s. */
const TAG_FADE_STEP_MS = 55;

export const BOARD_ALT =
  "A real Rowbly board for a Tic-Tac-Toe project, with 26 AI agents at work on Stories in Refinement, Development and Review.";

function percentX(x: number) {
  return `${(((x - CROP.left) / CROP_WIDTH) * 100).toFixed(3)}%`;
}

function percentY(y: number) {
  return `${(((y - CROP.top) / CROP_HEIGHT) * 100).toFixed(3)}%`;
}

function tagRowClipPath(top: number) {
  const insetTop = percentY(top);
  const insetRight = `${(((CROP.right - TAG_COLUMN.right) / CROP_WIDTH) * 100).toFixed(3)}%`;
  const insetBottom = `${(((CROP.bottom - top - ROW_HEIGHT) / CROP_HEIGHT) * 100).toFixed(3)}%`;
  const insetLeft = percentX(TAG_COLUMN.left);
  return `inset(${insetTop} ${insetRight} ${insetBottom} ${insetLeft})`;
}

type BoardShotProps = Readonly<{
  className?: string;
}>;

/** The board of the screenshot, cropped to the board panel. The agent tags fade in one after the other on load. */
export function BoardShot({ className }: BoardShotProps) {
  return (
    <div className={cn("relative", className)}>
      <img
        src="/images/board-no-tags.webp"
        alt={BOARD_ALT}
        width={CROP_WIDTH}
        height={CROP_HEIGHT}
        loading="eager"
        fetchPriority="high"
        className="block h-auto w-full"
      />
      {TAG_ROW_TOPS.map((top, index) => (
        <img
          key={top}
          src="/images/board.webp"
          alt=""
          aria-hidden="true"
          width={CROP_WIDTH}
          height={CROP_HEIGHT}
          loading="eager"
          className="board-tag-fade absolute inset-0 size-full"
          style={{ clipPath: tagRowClipPath(top), animationDelay: `${index * TAG_FADE_STEP_MS}ms` }}
        />
      ))}
    </div>
  );
}
