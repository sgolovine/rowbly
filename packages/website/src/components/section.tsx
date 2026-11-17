import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type SectionProps = Readonly<{
  id?: string;
  /** A short label above the headline. */
  eyebrow?: ReactNode;
  headline?: ReactNode;
  subhead?: ReactNode;
  children?: ReactNode;
  className?: string;
}>;

/** A page section. All sections have the same spacing and max width. */
export function Section({ id, eyebrow, headline, subhead, children, className }: SectionProps) {
  return (
    <section id={id} className={cn("px-4 py-16 sm:px-6 md:py-24", className)}>
      <div className="mx-auto max-w-6xl">
        {(eyebrow || headline || subhead) && (
          <div className="mb-10 max-w-3xl">
            {eyebrow && <p className="mb-3 font-mono text-sm text-brand-muted">{eyebrow}</p>}
            {headline && (
              <h2 className="text-3xl font-semibold tracking-tight text-brand-text md:text-4xl">{headline}</h2>
            )}
            {subhead && <p className="mt-4 text-lg text-brand-muted">{subhead}</p>}
          </div>
        )}
        {children}
      </div>
    </section>
  );
}
