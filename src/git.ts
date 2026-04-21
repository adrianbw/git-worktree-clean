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

export function listWorktrees(): Worktree[] {
  const output = execSync("git worktree list --porcelain", {
    encoding: "utf-8",
  });

  const blocks = output.trim().split("\n\n");

  // First block is the main worktree — skip it
  const worktreeBlocks = blocks.slice(1);

  return worktreeBlocks.map((block) => {
    const lines = block.split("\n");
    let path = "";
    let head = "";
    let branch: string | null = null;

    for (const line of lines) {
      if (line.startsWith("worktree ")) {
        path = line.slice("worktree ".length);
      } else if (line.startsWith("HEAD ")) {
        head = line.slice("HEAD ".length);
      } else if (line.startsWith("branch ")) {
        branch = line.slice("branch refs/heads/".length);
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

    return { path, head, branch, isDirty };
  });
}

export async function removeWorktree(
  path: string,
  force: boolean,
): Promise<void> {
  const forceFlag = force ? " --force" : "";
  await exec(`git worktree remove ${JSON.stringify(path)}${forceFlag}`);
}

export async function deleteBranch(branch: string): Promise<void> {
  await exec(`git branch -D ${JSON.stringify(branch)}`);
}

export async function pruneWorktrees(): Promise<void> {
  await exec("git worktree prune");
}
