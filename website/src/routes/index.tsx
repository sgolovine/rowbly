import { createFileRoute } from "@tanstack/react-router";
import { Hero } from "@/components/landing/hero";
import { HowItWorks } from "@/components/landing/how-it-works";
import { ProofStrip } from "@/components/landing/proof-strip";
import { SeeItWork } from "@/components/landing/see-it-work";
import { WatchLive } from "@/components/landing/watch-live";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <>
      <Hero />
      <ProofStrip />
      <SeeItWork />
      <HowItWorks />
      <WatchLive />
    </>
  );
}
