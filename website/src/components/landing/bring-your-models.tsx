import { Section } from "@/components/section";
import { TerminalFrame } from "@/components/terminal-frame";

const PROVIDERS = ["Anthropic", "OpenAI", "Google Gemini"] as const;

/** The rows of the settings mock. The labels are the labels of Settings › AI in the TUI. The values are demo values. */
const SETTINGS = [
  { label: "Supervisor model", value: "anthropic/claude-opus" },
  { label: "Worker model", value: "openai/gpt" },
  { label: "Worker limit", value: "4" },
] as const;

/** The "Bring your own models" section of the landing page. */
export function BringYourModels() {
  return (
    <Section
      id="models"
      headline="Your models. Your limits. Your keys."
      subhead="Sign in to Anthropic, OpenAI, Google Gemini and more. Pick one model to supervise and another to do the work. Set how many workers run at once. Change your mind any time."
    >
      <div className="grid items-center gap-10 lg:grid-cols-2">
        <ul aria-label="Model providers" className="flex flex-wrap gap-x-8 gap-y-4">
          {PROVIDERS.map((provider) => (
            <li key={provider} className="text-2xl font-semibold tracking-tight text-brand-text md:text-3xl">
              {provider}
            </li>
          ))}
        </ul>
        <TerminalFrame className="min-w-0">
          <div className="p-4 font-mono text-sm">
            <p className="mb-3 text-xs text-brand-muted">Settings › AI</p>
            <dl className="divide-y divide-brand-border rounded-md border border-brand-border">
              {SETTINGS.map((setting) => (
                <div
                  key={setting.label}
                  className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5"
                >
                  <dt className="text-brand-muted">{setting.label}</dt>
                  <dd className="min-w-0 break-all text-brand-text">{setting.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </TerminalFrame>
      </div>
    </Section>
  );
}
