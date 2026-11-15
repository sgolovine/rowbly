import { createFileRoute } from "@tanstack/react-router";
import { Hero } from "@/components/landing/hero";
import { ProofStrip } from "@/components/landing/proof-strip";
import { SeeItWork } from "@/components/landing/see-it-work";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Hero />
      <ProofStrip />
      <SeeItWork />
    </>
  );
}
