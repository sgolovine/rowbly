import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // A test that renders the shell records its project: it must not write to the real home directory.
    env: { HOME: join(tmpdir(), "rowbly-test-home"), USERPROFILE: join(tmpdir(), "rowbly-test-home") },
  },
});
