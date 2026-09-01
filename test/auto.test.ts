import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  blockRemoval,
  demoRepo,
  dirty,
  localBranches,
  lock,
  runGwc,
  worktreeBranches,
} from "./helpers.js";

const ANSI = /\x1b\[/;

describe("--auto", () => {
  it("removes every clean merged or closed worktree and its branch", (t) => {
    const demo = demoRepo(t);

    const { status, stdout, stderr } = runGwc(demo.repo, ["--auto"]);

    assert.equal(status, 0);
    assert.match(stdout, /Done\. Removed 4, skipped 0, failed 0\./);
    assert.deepEqual(worktreeBranches(demo.repo), [
      "(detached)",
      "feature/billing-v2",
      "spike/perf-profiling",
    ]);
    assert.deepEqual(localBranches(demo.repo), [
      "feature/billing-v2",
      "main",
      "spike/perf-profiling",
    ]);
    // The TUI paints on stderr, so a headless run must leave it empty.
    assert.equal(stderr, "");
  });

  it("writes no ANSI escapes when stdout is not a TTY", (t) => {
    const demo = demoRepo(t);

    const { stdout } = runGwc(demo.repo, ["--auto"]);

    assert.doesNotMatch(stdout, ANSI);
  });

  it("skips a merged worktree that has uncommitted changes", (t) => {
    const demo = demoRepo(t);
    dirty(demo.worktree("feature/dark-mode"));

    const { status, stdout } = runGwc(demo.repo, ["--auto"]);

    assert.equal(status, 0);
    assert.match(
      stdout,
      /Skipping 1 merged\/closed worktree that needs force removal:/,
    );
    assert.match(stdout, /feature\/dark-mode — has uncommitted changes/);
    assert.match(stdout, /Done\. Removed 3, skipped 1, failed 0\./);
    assert.ok(worktreeBranches(demo.repo).includes("feature/dark-mode"));
    assert.ok(localBranches(demo.repo).includes("feature/dark-mode"));
  });

  it("skips a merged worktree that is locked, and names the reason", (t) => {
    const demo = demoRepo(t);
    lock(demo.repo, demo.worktree("chore/bump-deps"), "keeping this one");

    const { status, stdout } = runGwc(demo.repo, ["--auto"]);

    assert.equal(status, 0);
    assert.match(stdout, /chore\/bump-deps — is locked \(keeping this one\)/);
    assert.match(stdout, /Done\. Removed 3, skipped 1, failed 0\./);
    assert.ok(worktreeBranches(demo.repo).includes("chore/bump-deps"));
  });

  it("force-removes a dirty merged worktree with -af", (t) => {
    const demo = demoRepo(t);
    dirty(demo.worktree("feature/dark-mode"));

    const { status, stdout } = runGwc(demo.repo, ["-af"]);

    assert.equal(status, 0);
    assert.match(stdout, /Force-removing 1 merged\/closed worktree:/);
    assert.match(stdout, /feature\/dark-mode — has uncommitted changes/);
    assert.match(stdout, /Done\. Removed 4, skipped 0, failed 0\./);
    assert.ok(!worktreeBranches(demo.repo).includes("feature/dark-mode"));
    assert.ok(!localBranches(demo.repo).includes("feature/dark-mode"));
  });

  it("force-removes a locked merged worktree, which git needs --force twice for", (t) => {
    const demo = demoRepo(t);
    lock(demo.repo, demo.worktree("chore/bump-deps"), "keeping this one");

    const { status, stdout } = runGwc(demo.repo, ["--auto", "--force"]);

    assert.equal(status, 0);
    assert.match(stdout, /chore\/bump-deps — is locked \(keeping this one\)/);
    assert.match(stdout, /Done\. Removed 4, skipped 0, failed 0\./);
    assert.ok(!worktreeBranches(demo.repo).includes("chore/bump-deps"));
  });

  it("reports nothing to remove when no PR is merged or closed", (t) => {
    const demo = demoRepo(t);
    runGwc(demo.repo, ["--auto"]);

    const { status, stdout } = runGwc(demo.repo, ["--auto"]);

    assert.equal(status, 0);
    assert.match(stdout, /Nothing to remove — no merged or closed PRs\./);
    assert.deepEqual(worktreeBranches(demo.repo), [
      "(detached)",
      "feature/billing-v2",
      "spike/perf-profiling",
    ]);
  });

  it("exits 1 and names the count when removals fail", (t) => {
    const demo = demoRepo(t);
    blockRemoval(demo);

    const { status, stdout, stderr } = runGwc(demo.repo, ["--auto"]);

    assert.equal(status, 1);
    assert.match(stdout, /Done\. Removed 0, skipped 0, failed 4\./);
    assert.match(stderr, /4 worktrees could not be removed\./);
    // A branch is only deleted once its worktree is gone, so all six survive.
    assert.deepEqual(localBranches(demo.repo), [
      "chore/bump-deps",
      "feature/api-pagination",
      "feature/billing-v2",
      "feature/dark-mode",
      "fix/login-redirect",
      "main",
      "spike/perf-profiling",
    ]);
  });
});
