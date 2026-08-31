#!/usr/bin/env bash
# Builds the throwaway demo repo the screenshot harness and the --auto smoke
# test both run against: seven worktrees covering every badge at once.
#
# Sourced for its build_demo_repo function, or run directly to build the repo at
# a given path: docs/screenshots/demo-repo.sh <dir>
set -euo pipefail

# `git worktree list` reports worktrees ordered by directory name, so these
# names determine row order in every screenshot.
DEMO_BRANCHES=(
  feature/api-pagination
  feature/dark-mode
  fix/login-redirect
  feature/billing-v2
  spike/perf-profiling
  chore/bump-deps
)

build_demo_repo() {
  rm -rf "$WORK/repo" "$WORK/wt"
  git init -q -b main "$WORK/repo"
  git -C "$WORK/repo" config user.email screenshots@example.com
  git -C "$WORK/repo" config user.name Screenshots
  git -C "$WORK/repo" config commit.gpgsign false
  echo "# acme-app" > "$WORK/repo/README.md"
  git -C "$WORK/repo" add -A
  git -C "$WORK/repo" commit -qm "init"

  for b in "${DEMO_BRANCHES[@]}"; do
    git -C "$WORK/repo" worktree add -q -b "$b" "$WORK/wt/$(basename "$b")" main
  done
  git -C "$WORK/repo" worktree add -q --detach "$WORK/wt/detached" main

  # One dirty worktree and one locked worktree, so `⚠ dirty` and `🔒 locked`
  # both appear and the force-removal prompts have something to ask about.
  echo "wip" > "$WORK/wt/billing-v2/scratch.txt"
  git -C "$WORK/repo" worktree lock --reason "long-running benchmark" "$WORK/wt/perf-profiling"
}

# Run directly (rather than sourced) → build at $1 and exit.
if [ "${BASH_SOURCE[0]}" = "$0" ]; then
  WORK="$1"
  build_demo_repo
fi
