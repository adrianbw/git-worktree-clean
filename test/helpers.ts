import { execFileSync, spawnSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BIN = join(REPO_ROOT, "bin", "git-worktree-clean");
const GH_STUB = join(REPO_ROOT, "docs", "screenshots", "gh-stub");
const DEMO_REPO = join(REPO_ROOT, "docs", "screenshots", "demo-repo.sh");

export interface DemoRepo {
  /** Temp directory holding both the repo and its worktrees. */
  dir: string;
  /** The main worktree, i.e. where the tool is run from. */
  repo: string;
  /** Path of the worktree checked out from `branch`. */
  worktree(branch: string): string;
}

/**
 * Builds the fixture the screenshot harness uses: seven worktrees covering
 * three merged PRs, one closed, one open, one dirty, one locked, one detached.
 * `gh-stub` maps those branch names to PR states, so the two must stay in step.
 */
export function demoRepo(t: TestContext): DemoRepo {
  const dir = mkdtempSync(join(tmpdir(), "gwtc-test-"));
  t.after(() => {
    // A test that blocks removal by dropping write permission leaves it dropped.
    try {
      chmodSync(join(dir, "wt"), 0o700);
    } catch {}
    rmSync(dir, { recursive: true, force: true });
  });

  execFileSync("bash", [DEMO_REPO, dir], { stdio: "ignore" });

  return {
    dir,
    repo: join(dir, "repo"),
    worktree: (branch: string) => join(dir, "wt", branch.split("/").pop()!),
  };
}

/** A repo with no worktrees beyond the main one. */
export function soloRepo(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "gwtc-solo-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", dir, ...args], { stdio: "ignore" });
  execFileSync("git", ["init", "-q", "-b", "main", dir], { stdio: "ignore" });
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  git("config", "commit.gpgsign", "false");
  writeFileSync(join(dir, "README.md"), "# solo\n");
  git("add", "-A");
  git("commit", "-qm", "init");
  return dir;
}

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Runs the launcher — the same entry point a user has on their PATH, so
 * whichever of `dist/` or `tsx` is current gets exercised.
 *
 * `gh` is the stub from the screenshot harness, since the fixture has no GitHub
 * remote to hold PRs. `ghOnPath: false` drops it to a PATH that still has node,
 * which is how a machine without the real CLI looks.
 */
export function runGwc(
  cwd: string,
  args: string[] = [],
  opts: { ghOnPath?: boolean; nodeOnlyBin?: string } = {},
): RunResult {
  const path =
    opts.ghOnPath === false
      ? `${opts.nodeOnlyBin}:/usr/bin:/bin`
      : `${GH_STUB}:${process.env.PATH}`;

  // NO_COLOR is stripped: whether the report carries ANSI is itself asserted.
  const { NO_COLOR, ...env } = process.env;
  const result = spawnSync(BIN, args, {
    cwd,
    encoding: "utf-8",
    env: { ...env, PATH: path, GH_STUB_DELAY: "0" },
  });

  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

/** A PATH entry holding node and nothing else, so `gh` cannot be resolved. */
export function nodeOnlyBin(t: TestContext): string {
  const dir = mkdtempSync(join(tmpdir(), "gwtc-nodeonly-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const bin = join(dir, "bin");
  mkdirSync(bin);
  symlinkSync(process.execPath, join(bin, "node"));
  return bin;
}

export function canResolve(command: string, path: string): boolean {
  const { status } = spawnSync("sh", ["-c", `command -v ${command}`], {
    env: { PATH: path },
    stdio: "ignore",
  });
  return status === 0;
}

/**
 * Branches of every worktree except the main one, sorted. A detached worktree
 * has no branch, so it reports as "(detached)".
 */
export function worktreeBranches(repo: string): string[] {
  const output = execFileSync(
    "git",
    ["-C", repo, "worktree", "list", "--porcelain"],
    { encoding: "utf-8" },
  );

  return output
    .trim()
    .split("\n\n")
    .slice(1)
    .map((block) => {
      const branch = block
        .split("\n")
        .find((line) => line.startsWith("branch "));
      return branch
        ? branch.slice("branch refs/heads/".length)
        : "(detached)";
    })
    .sort();
}

export function localBranches(repo: string): string[] {
  return execFileSync(
    "git",
    ["-C", repo, "branch", "--format=%(refname:short)"],
    { encoding: "utf-8" },
  )
    .trim()
    .split("\n")
    .sort();
}

export function dirty(path: string): void {
  writeFileSync(join(path, "scratch.txt"), "wip\n");
}

export function lock(repo: string, path: string, reason: string): void {
  execFileSync("git", ["-C", repo, "worktree", "lock", "--reason", reason, path]);
}

export function blockRemoval(demo: DemoRepo): void {
  chmodSync(join(demo.dir, "wt"), 0o500);
}
