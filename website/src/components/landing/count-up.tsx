import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

const COUNT_DURATION_MS = 1000;

type CountUpProps = Readonly<{
  /** The final number. The server render shows it. */
  value: number;
  className?: string;
}>;

function easeOutCubic(progress: number) {
  return 1 - (1 - progress) ** 3;
}

function isInViewport(element: Element) {
  const rect = element.getBoundingClientRect();
  return rect.top < window.innerHeight && rect.bottom > 0;
}

/**
 * A number that counts up from 0 one time, when it scrolls into view.
 * With reduced motion, or when the number is already in view, it shows the final number at once.
 * Screen readers read only the final number.
 */
export function CountUp({ value, className }: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(value);

  useEffect(() => {
    const element = ref.current;
    if (
      !element ||
      typeof IntersectionObserver === "undefined" ||
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ||
      isInViewport(element)
    ) {
      return;
    }

    let frame = 0;
    setDisplay(0);

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) {
          return;
        }
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / COUNT_DURATION_MS, 1);
          setDisplay(Math.round(easeOutCubic(progress) * value));
          if (progress < 1) {
            frame = requestAnimationFrame(tick);
          }
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.5 },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
      setDisplay(value);
    };
  }, [value]);

  return (
    <span ref={ref} className={cn("tabular-nums", className)}>
      <span aria-hidden="true">{display}</span>
      <span className="sr-only">{value}</span>
    </span>
  );
}
