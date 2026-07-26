/** State of a branch's most recent PR; null means it has none. */
export type PrState = "MERGED" | "CLOSED" | "OPEN" | null;

export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  lockReason: string | null;
  /**
   * Uncommitted changes present. `null` until the background check finishes —
   * the TUI paints before these resolve.
   */
  isDirty: boolean | null;
  /** `"pending"` until the background PR lookup for this branch finishes. */
  prState: PrState | "pending";
}
