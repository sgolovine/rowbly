// The pure parts of the factory watchdog: the crash policy and the state file. The process loop is a command.

export {
  acquireWatchdogClaim,
  claimHeld,
  type LiveWatchdog,
  liveWatchdog,
  readWatchdogClaim,
  releaseWatchdogClaim,
} from "./watchdog-claim.js";
export {
  BACKOFF_MS,
  backoffMs,
  CRASH_LIMIT,
  classifyExit,
  crashCountAfter,
  crashLimitReached,
  type DaemonExit,
  DEFAULT_TIMING,
  type ExitKind,
  exitText,
  STABLE_MS,
  type WatchdogTiming,
} from "./watchdog-policy.js";
export {
  activeWatchdog,
  CRASH_LIMIT_KEY,
  crashLimitText,
  probeWatchdog,
  readWatchdogState,
  type WatchdogPhase,
  type WatchdogState,
  watchdogActive,
  writeWatchdogState,
} from "./watchdog-state.js";
