import { createColors } from "./color.js";
import { getPrState, isDirty, isGhAvailable, pruneWorktrees } from "./git.js";
import { removeAll } from "./remove.js";
import type { RemovalOutcome, RemovalReporter } from "./remove.js";
import type { SpinnerLine } from "./spinner.js";
import type { Worktree } from "./types.js";
import { forceRemovalReasons } from "./ui.js";

const { dim, green, yellow, red } = createColors(process.stdout);

const plural = (n: number) => (n === 1 ? "" : "s");

/**
 * Stand-in for the spinner group. --auto has no cursor to move — its report is
 * meant to survive being piped to a log — so each line is printed once, when it
 * reaches its final state.
 */
function createPlainReporter(): RemovalReporter {
  const line = (symbol: string, text: string) =>
    console.log(`  ${symbol} ${text}`);

  return {
    create(): SpinnerLine {
      return {
        update() {},
        succeed: (text) => line(green("✓"), text),
        fail: (text) => line(red("✗"), text),
        warn: (text) => line(yellow("⚠"), text),
      };
    },
    stop() {},
  };
}

/**
 * Headless counterpart to the TUI: resolve every signal, remove the worktrees
 * whose PR is merged or closed, and print what happened. Worktrees that would
 * need `--force` are listed rather than removed, since nobody is there to
 * confirm.
 */
export async function runAuto(worktrees: Worktree[]): Promise<RemovalOutcome> {
  if (!(await isGhAvailable())) {
    console.error(
      "--auto needs the gh CLI to tell merged and closed branches apart.\n" +
        "Install it from https://cli.github.com, or run git-worktree-clean without --auto.",
    );
    process.exit(1);
  }

  console.log(
    `Checking ${worktrees.length} worktree${plural(worktrees.length)}...`,
  );

  await Promise.all([
    Promise.all(
      worktrees.map(async (wt) => {
        wt.isDirty = await isDirty(wt.path);
      }),
    ),
    Promise.all(
      worktrees.map(async (wt) => {
        if (wt.branch) wt.prState = await getPrState(wt.branch);
      }),
    ),
  ]);

  const clean: Worktree[] = [];
  const needsForce: Worktree[] = [];
  for (const wt of worktrees) {
    if (wt.prState !== "MERGED" && wt.prState !== "CLOSED") continue;
    if (wt.isDirty || wt.lockReason !== null) needsForce.push(wt);
    else clean.push(wt);
  }

  if (clean.length === 0 && needsForce.length === 0) {
    console.log("\nNothing to remove — no merged or closed PRs.");
    return { removedPaths: new Set(), failed: 0 };
  }

  // Announced ahead of the removals: the skip set is known up front, and it
  // reads better to name what survives before anything is deleted.
  if (needsForce.length > 0) {
    const n = needsForce.length;
    console.log(
      `\nSkipping ${n} merged/closed worktree${plural(n)} that ${n === 1 ? "needs" : "need"} force removal:`,
    );
    for (const wt of needsForce) {
      console.log(
        `  ${yellow("-")} ${wt.branch ?? wt.path} — ${forceRemovalReasons(wt)}`,
      );
    }
    console.log(dim("  Run git-worktree-clean without --auto to remove these."));
  }

  let outcome: RemovalOutcome = { removedPaths: new Set(), failed: 0 };

  if (clean.length > 0) {
    console.log(
      `\nRemoving ${clean.length} merged/closed worktree${plural(clean.length)}:`,
    );
    outcome = await removeAll(
      clean.map((wt) => ({ worktree: wt, force: false, locked: false })),
      createPlainReporter(),
    );
    console.log("\nPruning stale worktree references...");
    await pruneWorktrees();
  }

  console.log(
    `\nDone. Removed ${outcome.removedPaths.size}, ` +
      `skipped ${needsForce.length}, failed ${outcome.failed}.`,
  );
  if (outcome.failed > 0) {
    console.error(
      `${outcome.failed} worktree${plural(outcome.failed)} could not be removed.`,
    );
  }

  return outcome;
}
