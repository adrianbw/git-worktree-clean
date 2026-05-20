import { execSync, exec as execCb } from "node:child_process";
import { promisify } from "node:util";
import type { Worktree } from "./types.js";

const exec = promisify(execCb);

export function isInsideGitRepo(): boolean {
  try {
    execSync("git rev-parse --git-dir", { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function listWorktrees(): { mainPath: string; others: Worktree[] } {
  const output = execSync("git worktree list --porcelain", {
    encoding: "utf-8",
  });

  const blocks = output.trim().split("\n\n");

  // First block is the main worktree — extract its path, then skip it.
  const mainPath = blocks[0]
    .split("\n")
    .find((l) => l.startsWith("worktree "))!
    .slice("worktree ".length);

  const worktreeBlocks = blocks.slice(1);

  const others = worktreeBlocks.map((block) => {
    const lines = block.split("\n");
    let path = "";
    let head = "";
    let branch: string | null = null;
    let lockReason: string | null = null;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch refs/heads/".length);
      } else if (line === "locked" || line.startsWith("locked ")) {
        lockReason = line === "locked" ? "" : line.slice("locked ".length);
      }
      // "detached" line → branch stays null
    }

    let isDirty = false;
    try {
      const status = execSync(`git -C ${JSON.stringify(path)} status --porcelain`, {
        encoding: "utf-8",
      });
      isDirty = status.trim().length > 0;
    } catch {
      // If we can't check status, assume not dirty
    }

    return { path, head, branch, isDirty, lockReason, prMerged: false };
  });

  return { mainPath, others };
}

/**
 * Returns true if `branch` has a merged PR on the GitHub remote.
 * Returns false on any failure (gh not installed, no remote, no PR, etc.) —
 * a missing merged-PR signal should never block worktree cleanup.
 */
export async function isPrMerged(branch: string): Promise<boolean> {
  try {
    const { stdout } = await exec(
      `gh pr list --head ${JSON.stringify(branch)} --state merged --json number --limit 1`,
      { timeout: 10000 },
    );
    const arr = JSON.parse(stdout);
    return Array.isArray(arr) && arr.length > 0;
  } catch {
    return false;
  }
}

export async function removeWorktree(
  path: string,
  opts: { force?: boolean; locked?: boolean } = {},
): Promise<void> {
  // git requires `--force` once for dirty trees and twice for locked trees.
  const flags: string[] = [];
  if (opts.force || opts.locked) flags.push("--force");
  if (opts.locked) flags.push("--force");
  const flagStr = flags.length ? ` ${flags.join(" ")}` : "";
  await exec(`git worktree remove ${JSON.stringify(path)}${flagStr}`);
}

export async function deleteBranch(branch: string): Promise<void> {
  await exec(`git branch -D ${JSON.stringify(branch)}`);
}

export async function pruneWorktrees(): Promise<void> {
  await exec("git worktree prune");
}
