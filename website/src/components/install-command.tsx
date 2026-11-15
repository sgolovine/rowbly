import { Check, Copy } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const COPIED_DURATION_MS = 2000;

type InstallCommandProps = Readonly<{
  /** The command to show and to copy. */
  command?: string;
  className?: string;
}>;

/** A copy block that shows a command with a `$` prompt and a copy button. */
export function InstallCommand({ command = "npm install -g rowbly", className }: InstallCommandProps) {
  const [isCopied, setIsCopied] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timeoutRef.current), []);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(command);
    } catch {
      return;
    }
    setIsCopied(true);
    clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => setIsCopied(false), COPIED_DURATION_MS);
  }

  return (
    <div
      className={cn(
        "flex max-w-full items-center gap-3 rounded-lg border border-brand-border bg-brand-surface py-2 pr-2 pl-4 font-mono text-sm",
        className,
      )}
    >
      <code className="min-w-0 flex-1 overflow-x-auto whitespace-nowrap text-brand-text">
        <span aria-hidden="true" className="mr-2 text-brand-muted select-none">
          $
        </span>
        {command}
      </code>
      <div className="relative shrink-0">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Copy the command: ${command}`}
          onClick={handleCopy}
        >
          {isCopied ? <Check aria-hidden="true" className="text-brand-accent" /> : <Copy aria-hidden="true" />}
        </Button>
        {isCopied && (
          <span
            aria-hidden="true"
            className="absolute right-0 bottom-full mb-2 rounded-md bg-foreground px-2 py-1 font-sans text-xs whitespace-nowrap text-background"
          >
            Copied
          </span>
        )}
      </div>
      <span aria-live="polite" className="sr-only">
        {isCopied ? "Copied" : ""}
      </span>
    </div>
  );
}
