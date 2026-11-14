import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // Each fork loads Ink and React, about 200 MB. One fork per core fills the memory when several factory
    // workers run the tests together. VITEST_MAX_WORKERS or --maxWorkers overrides this cap.
    maxWorkers: 4,
    // A test that renders the shell records its project: it must not write to the real home directory.
    env: { HOME: join(tmpdir(), "rowbly-test-home"), USERPROFILE: join(tmpdir(), "rowbly-test-home") },
  },
});
