import { createColors } from "./color.js";
import { getPrState, isDirty, isGhAvailable, pruneWorktrees } from "./git.js";
import { removeAll } from "./remove.js";
import type {
  RemovalOutcome,
  RemovalReporter,
  RemovalTarget,
} from "./remove.js";
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
 * confirm — unless `force` is set, which opts into removing them unattended.
 */
export async function runAuto(
  worktrees: Worktree[],
  force: boolean,
): Promise<RemovalOutcome> {
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

  // Announced ahead of the removals: both sets are known up front, and it reads
  // better to name what is at stake before anything is deleted.
  if (needsForce.length > 0) {
    const n = needsForce.length;
    console.log(
      force
        ? `\nForce-removing ${n} merged/closed worktree${plural(n)}:`
        : `\nSkipping ${n} merged/closed worktree${plural(n)} that ${n === 1 ? "needs" : "need"} force removal:`,
    );
    for (const wt of needsForce) {
      console.log(
        `  ${yellow(force ? "!" : "-")} ${wt.branch ?? wt.path} — ${forceRemovalReasons(wt)}`,
      );
    }
    if (!force) {
      console.log(
        dim(
          "  Run git-worktree-clean without --auto, or add --force, to remove these.",
        ),
      );
    }
  }

  // A locked worktree needs `--force` even when its tree is clean, so the flags
  // are read off each worktree rather than shared across the batch.
  const targets: RemovalTarget[] = clean.map((wt) => ({
    worktree: wt,
    force: false,
    locked: false,
  }));
  if (force) {
    for (const wt of needsForce) {
      targets.push({
        worktree: wt,
        force: wt.isDirty === true,
        locked: wt.lockReason !== null,
      });
    }
  }

  let outcome: RemovalOutcome = { removedPaths: new Set(), failed: 0 };

  if (targets.length > 0) {
    console.log(
      `\nRemoving ${targets.length} merged/closed worktree${plural(targets.length)}:`,
    );
    outcome = await removeAll(targets, createPlainReporter());
    console.log("\nPruning stale worktree references...");
    await pruneWorktrees();
  }

  console.log(
    `\nDone. Removed ${outcome.removedPaths.size}, ` +
      `skipped ${force ? 0 : needsForce.length}, failed ${outcome.failed}.`,
  );
  if (outcome.failed > 0) {
    console.error(
      `${outcome.failed} worktree${plural(outcome.failed)} could not be removed.`,
    );
  }

  return outcome;
}
