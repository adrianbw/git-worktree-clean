export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  isDirty: boolean;
  lockReason: string | null;
  prMerged: boolean;
}
