import { Link } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";

/** The branded "Page not found" page. The build writes it to `404.html`, and the router shows it for an unknown path. */
export function NotFoundPage() {
  return (
    <div className="flex min-h-[60vh] flex-col items-center justify-center gap-6 px-6 py-24 text-center">
      <p className="font-mono text-5xl font-semibold text-brand-text">
        rowbly<span className="text-brand-accent">_</span>
      </p>
      <div className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold text-brand-text">Page not found</h1>
        <p className="text-brand-muted">The page that you asked for does not exist.</p>
      </div>
      <Button asChild>
        <Link to="/">Go to the home page</Link>
      </Button>
    </div>
  );
}
