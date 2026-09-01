import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { runAuto } from "./auto.js";
import {
  isInsideGitRepo,
  listWorktrees,
  pruneWorktrees,
  getPrState,
  isDirty,
} from "./git.js";
import { removeAll } from "./remove.js";
import type { RemovalTarget } from "./remove.js";
import { runTui, confirmForceRemoval } from "./ui.js";
import { createSpinnerGroup } from "./spinner.js";
import type { Worktree } from "./types.js";

const USAGE = `Usage: git-worktree-clean [options]

Options:
  -a, --auto   Remove every merged/closed worktree without opening the TUI and
               report the result. Dirty and locked worktrees are listed, not
               removed. Requires the gh CLI.
  -f, --force  Under --auto, remove those listed dirty and locked worktrees too.
               Destroys uncommitted work with no prompt. Inert on its own.
  -h, --help   Show this help.

Short flags bundle: -af is --auto --force.`;

interface Options {
  auto: boolean;
  force: boolean;
}

function parseOptions(argv: string[]): Options {
  let values;
  try {
    // strict:true is what refuses `--auto=true`, positionals and `--`, so the
    // "anything else is an error" guarantee needs no checks of our own.
    ({ values } = parseArgs({
      args: argv,
      options: {
        auto: { type: "boolean", short: "a" },
        force: { type: "boolean", short: "f" },
        help: { type: "boolean", short: "h" },
      },
      strict: true,
    }));
  } catch (err) {
    // parseArgs names the offending token, down to a single bad letter inside a
    // cluster: `-ax` is reported as `-x`.
    console.error(`${err instanceof Error ? err.message : err}\n\n${USAGE}`);
    process.exit(1);
  }

  if (values.help) {
    console.log(USAGE);
    process.exit(0);
  }

  return { auto: values.auto === true, force: values.force === true };
}

function warnIfCwdRemoved(
  removedPaths: Set<string>,
  originalCwd: string,
  mainPath: string,
) {
  const cwdRemoved = [...removedPaths].some(
    (p) => originalCwd === p || originalCwd.startsWith(p + "/"),
  );
  if (cwdRemoved) {
    console.log(`\nYour shell is in a removed worktree. Run: cd ${mainPath}`);
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2));

  if (!isInsideGitRepo()) {
    console.error("Not inside a git repository.");
    process.exit(1);
  }

  // --force only means anything to the unattended sweep: the interactive flow
  // asks before every force removal, so there is nothing there for it to skip.
  // Said here, ahead of every other early exit, so the flag is never silently
  // inert.
  if (options.force && !options.auto) {
    console.error(
      "-f/--force has no effect without -a/--auto — the interactive flow " +
        "always asks before force-removing.",
    );
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

  if (options.auto) {
    const outcome = await runAuto(worktrees, options.force);
    warnIfCwdRemoved(outcome.removedPaths, originalCwd, mainPath);
    // Set the code rather than exiting, so a piped report is never truncated.
    process.exitCode = outcome.failed > 0 ? 1 : 0;
    return;
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

  const toRemove: RemovalTarget[] = [];

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

  console.log(`\nRemoving ${toRemove.length} worktree${toRemove.length > 1 ? "s" : ""}...\n`);

  const { removedPaths } = await removeAll(toRemove, createSpinnerGroup());

  console.log("\nPruning stale worktree references...");
  await pruneWorktrees();
  console.log("Done.");

  warnIfCwdRemoved(removedPaths, originalCwd, mainPath);
}

main().catch((err: Error) => {
  if (err.name === "ExitPromptError") {
    process.exit(130);
  }
  console.error(err);
  process.exit(1);
});
