import type { Command } from "commander";
import {
  authRuntime,
  getAuthStatus,
  listProviders,
  loginProvider,
  logoutProvider,
} from "../../services/agentAuth/agentAuth.js";
import { ValidationError } from "../../services/errors/errors.js";
import { createCliAuthInteraction } from "../authWizard/authWizard.js";
import { run } from "../output/output.js";

export function registerAuthCommands(program: Command) {
  program
    .command("providers")
    .description("List provider login methods")
    .action((_opts: unknown, cmd: Command) =>
      run(
        cmd,
        async () => listProviders(await authRuntime()),
        (rows) => rows.map((p) => `${p.id}: ${p.methods.join(", ")}`).join("\n"),
      ),
    );
  program
    .command("status")
    .description("Show configured providers without a health check")
    .action((_opts: unknown, cmd: Command) =>
      run(
        cmd,
        async () => getAuthStatus(await authRuntime()),
        (rows) =>
          rows.map((p) => `${p.id}: ${p.configured ? "configured" : "not configured"} (health unverified)`).join("\n"),
      ),
    );
  program
    .command("login")
    .argument("[provider]")
    .option("--type <type>", "oauth or api_key")
    .description("Log in through a masked interactive prompt")
    .action((provider: string | undefined, opts: { type?: string }, cmd: Command) =>
      run(
        cmd,
        async (ctx) => {
          if (!process.stdin.isTTY || !process.stdout.isTTY || cmd.optsWithGlobals().json)
            throw new ValidationError("Login needs an interactive terminal", {
              hint: "Run rowbly auth login in a terminal without --json.",
            });
          const runtime = await authRuntime();
          const interaction = createCliAuthInteraction();
          const providers = await listProviders(runtime);
          provider ??= await interaction.prompt({
            type: "select",
            message: "Provider",
            options: providers.filter((p) => p.methods.length).map((p) => ({ id: p.id, label: p.id })),
          });
          const methods = providers.find((p) => p.id === provider)?.methods;
          if (!methods?.length) throw new ValidationError("Provider has no login method");
          const type =
            opts.type ??
            (methods.length === 1
              ? methods[0]
              : await interaction.prompt({
                  type: "select",
                  message: "Login method",
                  options: methods.map((id) => ({ id, label: id })),
                }));
          if (type !== "oauth" && type !== "api_key") throw new ValidationError("Use oauth or api_key");
          return loginProvider(runtime, provider, type, interaction, ctx);
        },
        (result) => `Logged in: ${result.provider}`,
      ),
    );
  program
    .command("logout")
    .argument("<provider>")
    .description("Remove a stored credential")
    .action((provider: string, _opts: unknown, cmd: Command) =>
      run(
        cmd,
        async () => logoutProvider(await authRuntime(), provider),
        (r) => `Logged out: ${r.provider}`,
      ),
    );
}
