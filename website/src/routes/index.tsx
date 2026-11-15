import { createFileRoute } from "@tanstack/react-router";
import { SeeItWork } from "@/components/landing/see-it-work";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <div className="flex min-h-[60vh] items-center justify-center">
        <h1 className="font-mono text-5xl font-semibold text-brand-text">
          rowbly<span className="text-brand-accent">_</span>
        </h1>
      </div>
      <SeeItWork />
    </>
  );
}
