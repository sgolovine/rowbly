import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type KbdProps = Readonly<{
  children: ReactNode;
  className?: string;
}>;

/** A keycap for a key, for example `f` or `s`. */
export function Kbd({ children, className }: KbdProps) {
  return (
    <kbd
      className={cn(
        "inline-flex h-6 min-w-6 items-center justify-center rounded border border-b-2 border-brand-border bg-brand-surface px-1.5 font-mono text-xs text-brand-text",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
