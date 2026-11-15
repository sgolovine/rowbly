import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type TerminalFrameProps = Readonly<{
  children: ReactNode;
  /** Adds a soft amber glow around the frame. */
  glow?: boolean;
  className?: string;
}>;

/** A terminal window frame with a title bar. It wraps an image or other content. */
export function TerminalFrame({ children, glow = false, className }: TerminalFrameProps) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-lg border border-brand-border bg-brand-surface",
        glow && "shadow-[0_0_60px_-15px_var(--color-brand-accent)]",
        className,
      )}
    >
      <div className="relative flex h-9 items-center border-b border-brand-border px-3">
        <div aria-hidden="true" className="flex gap-1.5">
          <span className="size-2.5 rounded-full bg-brand-border" />
          <span className="size-2.5 rounded-full bg-brand-border" />
          <span className="size-2.5 rounded-full bg-brand-border" />
        </div>
        <span className="absolute inset-x-0 text-center font-mono text-xs text-brand-muted">rowbly</span>
      </div>
      <div className="[&>img]:block [&>img]:h-auto [&>img]:w-full">{children}</div>
    </div>
  );
}
