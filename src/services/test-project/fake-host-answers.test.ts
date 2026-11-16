import { describe, expect, it } from "vitest";
import { answerFor, answerKey, healthyAnswers } from "./fake-host-answers.js";

describe("fake host answers", () => {
  it("gives a key for each check command", () => {
    expect(answerKey(["uname", "-s"])).toBe("uname");
    expect(answerKey(["git", "--version"])).toBe("git-version");
    expect(answerKey(["git", "-C", "clone", "config", "--get", "user.name"])).toBe("git-config-user.name");
    expect(answerKey(["a/rowbly", "--version"])).toBe("rowbly-version");
    expect(answerKey(["a/rowbly", "--json", "model", "list"])).toBe("rowbly-model");
    expect(answerKey(["env", "GIT_TERMINAL_PROMPT=0", "git"])).toBe("git-push");
  });

  it("answers a command without an answer with exit code 127", () => {
    expect(answerFor(healthyAnswers(), ["uname", "-s"]).bytes.toString()).toBe("Linux\n");
    expect(answerFor({}, ["gh"]).exitCode).toBe(127);
  });
});
