import { AnimatedBoard } from "@/components/landing/animated-board";
import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";

/** The "Stories move themselves" section of the landing page. An animated board teaches the main loop. */
export function SeeItWork() {
  return (
    <Section
      id="see-it-work"
      headline="Stories move themselves."
      subhead="You write a Story in a sentence. The factory picks it up, refines it into a spec, builds it on its own branch, opens a PR and moves it to review. You read the PR and press merge."
    >
      <TerminalFrame>
        <AnimatedBoard />
      </TerminalFrame>
    </Section>
  );
}
