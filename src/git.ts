import { execSync, exec as execCb, spawn } from "node:child_process";
import { promisify } from "node:util";
import type { PrState, Worktree } from "./types.js";

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

  const others = worktreeBlocks.map((block): Worktree => {
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

    return {
      path,
      head,
      branch,
      // Resolved asynchronously by isDirty() / getPrState() so the TUI can
      // paint before the slow per-worktree checks finish. null = not yet known.
      isDirty: null,
      lockReason,
      prState: "pending",
    };
  });

  return { mainPath, others };
}

/**
 * Whether `path` has uncommitted changes (including untracked files).
 *
 * Uses spawn rather than exec so we can bail the moment git emits its first
 * byte of output — for a dirty worktree that avoids walking the rest of the
 * tree, and it means output size is irrelevant (an exec buffer overflow on a
 * very dirty worktree would otherwise look like "clean").
 */
export function isDirty(path: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (dirty: boolean) => {
      if (settled) return;
      settled = true;
      resolve(dirty);
    };

    const child = spawn("git", ["-C", path, "status", "--porcelain"], {
      stdio: ["ignore", "pipe", "ignore"],
    });

    child.stdout.on("data", (chunk: Buffer) => {
      // Any output at all means the worktree is dirty; stop git early.
      if (chunk.length > 0) {
        finish(true);
        child.kill();
      }
    });

    // No output by the time git exits → clean. If git failed to run at all we
    // also land here; treating that as "not dirty" matches the prior behaviour
    // (a missing dirty signal must never block cleanup).
    child.on("close", () => finish(false));
    child.on("error", () => finish(false));
  });
}

/**
 * Returns the state of the most recent PR for `branch` on the GitHub remote,
 * or null if there is none. Returns null on any failure (gh not installed, no
 * remote, no PR, etc.) — a missing PR signal should never block worktree
 * cleanup.
 */
export async function getPrState(branch: string): Promise<PrState> {
  try {
    const { stdout } = await exec(
      `gh pr list --head ${JSON.stringify(branch)} --state all --json state --limit 1`,
      { timeout: 10000 },
    );
    const arr = JSON.parse(stdout);
    if (!Array.isArray(arr) || arr.length === 0) return null;
    const state = arr[0]?.state;
    if (state === "MERGED" || state === "CLOSED" || state === "OPEN") {
      return state;
    }
    return null;
  } catch {
    return null;
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
