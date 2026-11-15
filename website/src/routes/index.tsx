import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-brand-background">
      <h1 className="font-mono text-5xl font-semibold text-brand-text">
        rowbly<span className="text-brand-accent">_</span>
      </h1>
    </main>
  );
}
