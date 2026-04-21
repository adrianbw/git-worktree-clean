import { checkbox } from "@inquirer/prompts";
import type { Worktree } from "./types.js";

export async function selectWorktrees(
  worktrees: Worktree[],
): Promise<Worktree[]> {
  return checkbox({
    message: "Select worktrees to remove:",
    choices: worktrees.map((wt) => ({
      name: `${wt.branch ?? "(detached)"}${wt.isDirty ? " ⚠ dirty" : ""}`,
      value: wt,
      description: `${wt.path}  (${wt.head.slice(0, 8)})`,
    })),
  });
}

export function confirmDirtyRemoval(wt: Worktree): Promise<boolean> {
  const label = wt.branch ?? wt.path;
  process.stdout.write(`⚠ "${label}" has uncommitted changes. Force remove? (y/n) `);

  return new Promise((resolve) => {
    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const onData = (key: Buffer) => {
      const ch = key.toString().toLowerCase();
      if (ch === "y") {
        process.stdout.write("y\n");
        cleanup();
        resolve(true);
      } else if (ch === "n") {
        process.stdout.write("n\n");
        cleanup();
        resolve(false);
      } else if (ch === "\x03") {
        // Ctrl+C
        process.stdout.write("\n");
        cleanup();
        process.exit(130);
      }
      // Ignore other keys
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };

    stdin.on("data", onData);
  });
}
