import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  canResolve,
  demoRepo,
  nodeOnlyBin,
  runGwc,
  soloRepo,
  worktreeBranches,
} from "./helpers.js";

describe("command line", () => {
  it("prints the usage for --help, outside a git repo too", (t) => {
    const solo = soloRepo(t);

    for (const flag of ["--help", "-h"]) {
      const { status, stdout } = runGwc(solo, [flag]);
      assert.equal(status, 0, flag);
      assert.match(stdout, /Usage: git-worktree-clean \[options\]/, flag);
      assert.match(stdout, /-a, --auto/, flag);
      assert.match(stdout, /-f, --force/, flag);
    }
  });

  it("rejects an unknown argument", (t) => {
    const solo = soloRepo(t);

    const { status, stderr } = runGwc(solo, ["--nope"]);

    assert.equal(status, 1);
    assert.match(stderr, /Unknown option '--nope'/);
    assert.match(stderr, /Usage: git-worktree-clean \[options\]/);
  });

  it("bundles short flags, and names a bad letter on its own", (t) => {
    const solo = soloRepo(t);

    const help = runGwc(solo, ["-ah"]);
    assert.equal(help.status, 0);
    assert.match(help.stdout, /Usage: git-worktree-clean \[options\]/);

    const bad = runGwc(solo, ["-ax"]);
    assert.equal(bad.status, 1);
    assert.match(bad.stderr, /Unknown option '-x'/);
    assert.match(bad.stderr, /Usage: git-worktree-clean \[options\]/);
  });

  it("warns that -f alone is inert, and stays quiet when bundled with -a", (t) => {
    const solo = soloRepo(t);

    // soloRepo exits at "No additional worktrees found." — the only path a test
    // can reach, since anything with worktrees blocks in the TUI waiting on a
    // keypress.
    const alone = runGwc(solo, ["-f"]);
    assert.equal(alone.status, 0);
    assert.match(alone.stderr, /-f\/--force has no effect without -a\/--auto/);

    const bundled = runGwc(solo, ["-af"]);
    assert.equal(bundled.status, 0);
    assert.doesNotMatch(bundled.stderr, /no effect/);
  });

  it("exits quietly when the repo has only a main worktree", (t) => {
    const solo = soloRepo(t);

    const { status, stdout } = runGwc(solo, ["--auto"]);

    assert.equal(status, 0);
    assert.match(stdout, /No additional worktrees found\./);
  });

  it("refuses --auto and -a without the gh CLI, and removes nothing", (t) => {
    const demo = demoRepo(t);
    const bin = nodeOnlyBin(t);
    assert.equal(
      canResolve("gh", `${bin}:/usr/bin:/bin`),
      false,
      "the stripped PATH must not resolve gh",
    );

    for (const flag of ["--auto", "-a"]) {
      const { status, stderr } = runGwc(demo.repo, [flag], {
        ghOnPath: false,
        nodeOnlyBin: bin,
      });

      assert.equal(status, 1, flag);
      assert.match(stderr, /--auto needs the gh CLI/, flag);
      assert.equal(worktreeBranches(demo.repo).length, 7, flag);
    }
  });
});
