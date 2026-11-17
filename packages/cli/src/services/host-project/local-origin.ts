import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ValidationError } from "../errors/errors.js";

const run = promisify(execFile);

/** The `origin` URL of the local repository at `root`. A repository without `origin` gives `VALIDATION`. */
export async function localOrigin(root: string): Promise<string> {
  const url = await run("git", ["-C", root, "remote", "get-url", "origin"]).then(
    (result) => result.stdout.trim(),
    () => "",
  );

  if (url === "") {
    throw new ValidationError(`The Project at ${root} has no origin remote.`, {
      hint: "Add the remote with `git remote add origin <url>`, then run the command again.",
      details: { issues: [{ path: ["origin"], message: "The local repository must have an origin remote" }] },
    });
  }

  return url;
}
