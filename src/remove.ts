import { deleteBranch, removeWorktree } from "./git.js";
import type { SpinnerLine } from "./spinner.js";
import type { Worktree } from "./types.js";

export interface RemovalTarget {
  worktree: Worktree;
  force: boolean;
  locked: boolean;
}

/**
 * Where per-worktree progress goes. `createSpinnerGroup()` satisfies this for
 * the interactive flow; --auto passes a plain-line reporter.
 */
export interface RemovalReporter {
  create(text: string): SpinnerLine;
  stop(): void;
}

export interface RemovalOutcome {
  /** Paths of worktrees that are gone, whether or not the branch went with them. */
  removedPaths: Set<string>;
  failed: number;
}

/**
 * Removes every target in parallel and deletes each one's branch. One failure
 * never aborts the others.
 */
export async function removeAll(
  targets: RemovalTarget[],
  reporter: RemovalReporter,
): Promise<RemovalOutcome> {
  const removedPaths = new Set<string>();
  let failed = 0;

  await Promise.allSettled(
    targets.map(async ({ worktree: wt, force, locked }) => {
      const label = wt.branch ?? wt.path;
      const line = reporter.create(label);

      try {
        await removeWorktree(wt.path, { force, locked });
        removedPaths.add(wt.path);
      } catch (err) {
        failed++;
        line.fail(`${label}: ${err instanceof Error ? err.message : err}`);
        return;
      }

      if (wt.branch) {
        line.update(`${label} — deleting branch...`);
        try {
          await deleteBranch(wt.branch);
          line.succeed(`${label} — worktree + branch removed`);
        } catch {
          line.warn(`${label} — worktree removed, branch could not be deleted`);
        }
      } else {
        line.succeed(`${label} — worktree removed`);
      }
    }),
  );

  reporter.stop();
  return { removedPaths, failed };
}
