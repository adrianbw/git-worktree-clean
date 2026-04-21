import {
  isInsideGitRepo,
  listWorktrees,
  removeWorktree,
  deleteBranch,
  pruneWorktrees,
} from "./git.js";
import { selectWorktrees, confirmDirtyRemoval } from "./ui.js";
import { createSpinnerGroup } from "./spinner.js";
import type { Worktree } from "./types.js";

async function main() {
  if (!isInsideGitRepo()) {
    console.error("Not inside a git repository.");
    process.exit(1);
  }

  const worktrees = listWorktrees();

  if (worktrees.length === 0) {
    console.log("No additional worktrees found.");
    process.exit(0);
  }

  const selected = await selectWorktrees(worktrees);

  if (selected.length === 0) {
    console.log("Nothing selected.");
    process.exit(0);
  }

  // Confirm dirty worktrees sequentially
  const toRemove: Array<{ worktree: Worktree; force: boolean }> = [];

  for (const wt of selected) {
    if (wt.isDirty) {
      const confirmed = await confirmDirtyRemoval(wt);
      if (!confirmed) {
        console.log(`Skipping ${wt.branch ?? wt.path}`);
        continue;
      }
      toRemove.push({ worktree: wt, force: true });
    } else {
      toRemove.push({ worktree: wt, force: false });
    }
  }

  if (toRemove.length === 0) {
    console.log("All dirty worktrees skipped.");
    process.exit(0);
  }

  // Remove in parallel with spinners
  console.log(`\nRemoving ${toRemove.length} worktree${toRemove.length > 1 ? "s" : ""}...\n`);

  const spinners = createSpinnerGroup();

  await Promise.allSettled(
    toRemove.map(async ({ worktree: wt, force }) => {
      const label = wt.branch ?? wt.path;
      const spinner = spinners.create(label);

      try {
        await removeWorktree(wt.path, force);
      } catch (err) {
        spinner.fail(
          `${label}: ${err instanceof Error ? err.message : err}`,
        );
        return;
      }

      if (wt.branch) {
        spinner.update(`${label} — deleting branch...`);
        try {
          await deleteBranch(wt.branch);
          spinner.succeed(`${label} — worktree + branch removed`);
        } catch {
          spinner.warn(`${label} — worktree removed, branch could not be deleted`);
        }
      } else {
        spinner.succeed(`${label} — worktree removed`);
      }
    }),
  );

  spinners.stop();

  console.log("\nPruning stale worktree references...");
  await pruneWorktrees();
  console.log("Done.");
}

main().catch((err: Error) => {
  if (err.name === "ExitPromptError") {
    process.exit(130);
  }
  console.error(err);
  process.exit(1);
});
