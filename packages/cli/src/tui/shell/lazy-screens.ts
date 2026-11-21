import { lazy } from "react";

/*
 * The screens that the board does not show at launch. Each dynamic `import()` becomes a separate chunk, so the TUI
 * loads less code before the first render. Render each one inside a `Suspense` boundary.
 */

/** The Settings Modal. */
export const LazySettingsModal = lazy(() =>
  import("../screens/settings/settings-modal/index.js").then((m) => ({ default: m.SettingsModal })),
);

/** The Factory Modal. */
export const LazyFactoryModal = lazy(() =>
  import("../screens/factory/factory-modal/index.js").then((m) => ({ default: m.FactoryModal })),
);

/** The Checks Modal. */
export const LazyChecksModal = lazy(() =>
  import("../screens/factory/checks-modal/index.js").then((m) => ({ default: m.ChecksModal })),
);

/** The setup Modal of the worker model, for a Project without one. */
export const LazyWorkerModelSetup = lazy(() =>
  import("../screens/settings/worker-model-setup/index.js").then((m) => ({ default: m.WorkerModelSetup })),
);

/** The onboarding steps, for a folder with no Project. */
export const LazyOnboarding = lazy(() =>
  import("../screens/onboarding/onboarding/index.js").then((m) => ({ default: m.Onboarding })),
);
