// =============================================================================
// Public API - HTTP-based split lifecycle management
// =============================================================================

export { getPayTo } from "./getPayTo.js";

export {
  ensureSplit,
  type EnsureResult,
  type EnsureParams,
  type BlockedReason,
} from "./ensureSplit.js";

export {
  updateSplit,
  type UpdateResult,
  type UpdateParams,
  type UpdateBlockedReason,
} from "./updateSplit.js";

export {
  closeSplit,
  type CloseResult,
  type CloseParams,
  type CloseBlockedReason,
} from "./closeSplit.js";

export {
  executeSplit,
  type ExecuteResult,
  type ExecuteParams,
  type SkippedReason,
} from "./executeSplit.js";

// =============================================================================
// Re-exports from @cascade-fyi/splits-sdk for advanced users
// =============================================================================

export type { Recipient } from "@cascade-fyi/splits-sdk/core";
export type { SplitConfig } from "@cascade-fyi/splits-sdk/core";

export { isCascadeSplit } from "@cascade-fyi/splits-sdk/core";
