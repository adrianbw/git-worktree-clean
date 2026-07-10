import { writeFileSync } from "node:fs";
import {
  isInsideGitRepo,
  listWorktrees,
  removeWorktree,
  deleteBranch,
  pruneWorktrees,
  getPrState,
} from "./git.js";
import { runTui, confirmForceRemoval } from "./ui.js";
import { createSpinnerGroup } from "./spinner.js";
import type { Worktree } from "./types.js";

async function main() {
  if (!isInsideGitRepo()) {
    console.error("Not inside a git repository.");
    process.exit(1);
  }

  const originalCwd = process.cwd();
  const { mainPath, others: worktrees } = listWorktrees();

  // chdir into the main worktree so we don't hold a cwd we might delete —
  // otherwise removing the worktree we're standing in breaks subsequent
  // git commands (and the user's shell after we exit).
  process.chdir(mainPath);

  if (worktrees.length === 0) {
    console.log("No additional worktrees found.");
    process.exit(0);
  }

  process.stderr.write("Checking PR status...\n");
  await Promise.allSettled(
    worktrees.map(async (wt) => {
      if (!wt.branch) return;
      const state = await getPrState(wt.branch);
      wt.prMerged = state === "MERGED";
      wt.prClosed = state === "CLOSED";
    }),
  );
  // Erase the "Checking PR status..." line so the TUI starts at the top.
  process.stderr.write("\x1b[1A\x1b[2K");

  const result = await runTui(worktrees);

  if (result.type === "quit") {
    process.exit(0);
  }
  if (result.type === "open") {
    const cdFile = process.env.GIT_WORKTREE_CLEAN_CD_FILE;
    if (cdFile) {
      writeFileSync(cdFile, result.worktree.path);
      process.exit(0);
    }
    console.error(
      `\nShell function not installed — cannot cd from a subprocess.\n` +
        `Re-run install.sh and reload your shell, then 'o' will cd to:\n  ${result.worktree.path}`,
    );
    process.exit(1);
  }

  const selected: Worktree[] =
    result.type === "select" ? result.worktrees : [];

  if (selected.length === 0) {
    console.log("Nothing selected.");
    process.exit(0);
  }

  // Confirm dirty / locked worktrees sequentially
  const toRemove: Array<{
    worktree: Worktree;
    force: boolean;
    locked: boolean;
  }> = [];

  for (const wt of selected) {
    const locked = wt.lockReason !== null;
    if (wt.isDirty || locked) {
      const confirmed = await confirmForceRemoval(wt);
      if (!confirmed) {
        console.log(`Skipping ${wt.branch ?? wt.path}`);
        continue;
      }
    }
    toRemove.push({ worktree: wt, force: wt.isDirty, locked });
  }

  if (toRemove.length === 0) {
    console.log("Nothing to remove.");
    process.exit(0);
  }

  // Remove in parallel with spinners
  console.log(`\nRemoving ${toRemove.length} worktree${toRemove.length > 1 ? "s" : ""}...\n`);

  const spinners = createSpinnerGroup();
  const removedPaths = new Set<string>();

  await Promise.allSettled(
    toRemove.map(async ({ worktree: wt, force, locked }) => {
      const label = wt.branch ?? wt.path;
      const spinner = spinners.create(label);

      try {
        await removeWorktree(wt.path, { force, locked });
        removedPaths.add(wt.path);
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

  const cwdRemoved = [...removedPaths].some(
    (p) => originalCwd === p || originalCwd.startsWith(p + "/"),
  );
  if (cwdRemoved) {
    console.log(
      `\nYour shell is in a removed worktree. Run: cd ${mainPath}`,
    );
  }
}

main().catch((err: Error) => {
  if (err.name === "ExitPromptError") {
    process.exit(130);
  }
  console.error(err);
  process.exit(1);
});
