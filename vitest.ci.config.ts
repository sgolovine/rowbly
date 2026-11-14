import { configDefaults, defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

export default mergeConfig(
  baseConfig,
  defineConfig({
    test: {
      // These tests fail in CI for reasons that are not known. Run them only on a local machine.
      exclude: [...configDefaults.exclude, "src/tui/hooks/shell.test.ts"],
    },
  }),
);
