export interface Worktree {
  path: string;
  head: string;
  branch: string | null;
  isDirty: boolean;
}
