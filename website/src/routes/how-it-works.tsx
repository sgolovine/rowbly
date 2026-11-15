import { createFileRoute } from "@tanstack/react-router";
import { GetStarted } from "@/components/how-it-works/get-started";
import { Intro } from "@/components/how-it-works/intro";
import { StagePrompts } from "@/components/how-it-works/stage-prompts";
import { TheBoard } from "@/components/how-it-works/the-board";
import { TheFactory } from "@/components/how-it-works/the-factory";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/how-it-works")({
  head: () =>
    pageHead({
      path: "/how-it-works",
      title: "How it works | Rowbly",
      description:
        "How Rowbly works: Stories as files in your repo, a prompt for each Stage, a supervisor and workers that run as Pi sessions.",
    }),
  component: HowItWorksPage,
});

function HowItWorksPage() {
  return (
    <>
      <Intro />
      <TheBoard />
      <StagePrompts />
      <TheFactory />
      <GetStarted />
    </>
  );
}
