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
    }
  });

  it("rejects an unknown argument", (t) => {
    const solo = soloRepo(t);

    const { status, stderr } = runGwc(solo, ["--nope"]);

    assert.equal(status, 1);
    assert.match(stderr, /Unknown argument: --nope/);
    assert.match(stderr, /Usage: git-worktree-clean \[options\]/);
  });

  it("does not bundle short flags", (t) => {
    const solo = soloRepo(t);

    const { status, stderr } = runGwc(solo, ["-ah"]);

    assert.equal(status, 1);
    assert.match(stderr, /Unknown argument: -ah/);
    assert.match(stderr, /Usage: git-worktree-clean \[options\]/);
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
