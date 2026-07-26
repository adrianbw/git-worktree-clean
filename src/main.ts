import { writeFileSync } from "node:fs";
import {
  isInsideGitRepo,
  listWorktrees,
  removeWorktree,
  deleteBranch,
  pruneWorktrees,
  getPrState,
  isDirty,
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

  // A detached worktree has no branch to look up, so it is never pending.
  for (const wt of worktrees) {
    if (!wt.branch) wt.prState = null;
  }

  // Paint the list right away, then fill in the slow per-worktree signals
  // (`git status` walks the whole tree; `gh` hits the network) concurrently.
  // Rows gain their badges as each check lands.
  const tui = runTui(worktrees);

  const dirtyChecked = Promise.all(
    worktrees.map(async (wt) => {
      wt.isDirty = await isDirty(wt.path);
      tui.refresh();
    }),
  ).catch(() => {});

  // Nothing awaits the PR lookups: the only action that depends on them ('c')
  // is gated inside the TUI, which reads the worktrees live.
  void Promise.all(
    worktrees.map(async (wt) => {
      if (!wt.branch) return;
      wt.prState = await getPrState(wt.branch);
      tui.refresh();
    }),
  ).catch(() => {});

  const result = await tui.result;

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

  // The force-removal prompts below depend on dirty state, so wait for the
  // background checks here — by now they have usually long since finished.
  await dirtyChecked;

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
    toRemove.push({ worktree: wt, force: wt.isDirty === true, locked });
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
