#!/usr/bin/env bash
# Regenerates the SVG screenshots in docs/ from the real binary.
#
# Builds a throwaway git repo with worktrees covering every badge the TUI can
# show, runs the app under a pty with scripted keystrokes, and renders the
# captured ANSI to SVG. Every screenshot is genuine output: real git, real
# removals, real `git status`. Only `gh` is stubbed, since the demo repo has no
# GitHub remote to have PRs on.
#
# Usage: docs/screenshots/capture.sh [outdir]   (default: docs/)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
OUTDIR="${1:-$REPO/docs}"

# shellcheck source=demo-repo.sh
source "$HERE/demo-repo.sh"

WORK="$(mktemp -d -t gwtc-shots)"
trap 'rm -rf "$WORK"' EXIT

# Runs the app under a pty, feeding it keystrokes from stdin. A pty is required:
# the TUI needs raw mode, and color switches off when stderr is not a TTY.
run_under_pty() {
  local outfile="$1"
  shift
  if script -q /dev/null true >/dev/null 2>&1; then
    script -q "$outfile" "$REPO/bin/git-worktree-clean" "$@"      # BSD / macOS
  else
    script -q -e -c "$REPO/bin/git-worktree-clean $*" "$outfile"  # GNU / Linux
  fi
}

capture() {
  local name="$1" driver="$2"
  build_demo_repo
  ( cd "$WORK/repo" && printf '%s' "$driver" | bash | run_under_pty "$WORK/$name.ansi" ) >/dev/null 2>&1 || true
}

export PATH="$HERE/gh-stub:$PATH"
export COLUMNS=100 LINES=30
chmod +x "$HERE/gh-stub/gh"

render() {
  node "$HERE/render.mjs" "$@"
}

echo "→ tui.svg + checking.svg (browse and select)"
capture browse '
sleep 2.2
printf "\x1b[B"; sleep 0.15
printf "\x1b[B"; sleep 0.15   # -> chore/bump-deps
printf " ";      sleep 0.15   # select it
printf "\x1b[B"; sleep 0.15   # -> feature/dark-mode
printf " ";      sleep 0.15   # select it
printf "\x1b[B"; sleep 0.15   # -> (detached)
printf "\x1b[B"; sleep 0.4    # -> fix/login-redirect
printf "q";      sleep 0.4
'
render "$WORK/browse.ansi" "$OUTDIR/tui.svg" --title "git-worktree-clean"
# Frame 3 lands while the per-worktree checks are still resolving.
render "$WORK/browse.ansi" "$OUTDIR/checking.svg" --frame 3 --title "git-worktree-clean"

echo "→ gated.svg (c pressed before the PR lookups finish)"
GH_STUB_DELAY=6 capture gated '
sleep 0.35
printf "c"; sleep 0.5
printf "q"; sleep 0.3
'
render "$WORK/gated.ansi" "$OUTDIR/gated.svg" --title "git-worktree-clean"

echo "→ clean.svg (c sweeps every merged/closed worktree)"
capture clean '
sleep 2.2
printf "c"
sleep 3.0
'
render "$WORK/clean.ansi" "$OUTDIR/clean.svg" --trim-top 9 \
  --title "git-worktree-clean — c (clean merged/closed)"

echo "→ force.svg (dirty and locked force-removal prompts)"
# Rows, in list order: api-pagination, billing-v2, bump-deps, dark-mode,
# detached, login-redirect, perf-profiling. This walks to the dirty one and the
# locked one, the two that trigger a force-removal prompt.
capture force '
sleep 2.2
printf "\x1b[B"; sleep 0.15   # -> feature/billing-v2 (dirty)
printf " ";      sleep 0.2    # select it
for _ in 1 2 3 4 5; do printf "\x1b[B"; sleep 0.15; done
printf " ";      sleep 0.3    # select spike/perf-profiling (locked)
printf "\r";     sleep 1.0    # confirm
printf "y";      sleep 0.8
printf "y";      sleep 3.0
'
# Crop the eight list rows, leaving the prompts and the removal output.
render "$WORK/force.ansi" "$OUTDIR/force.svg" --trim-top 8 \
  --title "git-worktree-clean — force removal"

echo "→ auto.svg (--auto sweeps merged/closed with no TUI)"
build_demo_repo
# feature/dark-mode has a merged PR; dirtying it gives --auto something to
# report as skipped alongside the worktrees it removes.
echo "wip" > "$WORK/wt/dark-mode/scratch.txt"
# The `sleep` holds stdin open: --auto never reads a key, and an stdin that
# closes first makes the pty echo a stray ^D into the capture.
( cd "$WORK/repo" && sleep 8 | run_under_pty "$WORK/auto.ansi" --auto ) >/dev/null 2>&1 || true
render "$WORK/auto.ansi" "$OUTDIR/auto.svg" --title "git-worktree-clean --auto"

# The demo repo's worktrees live under $WORK, but its branches were only ever
# local to it, so nothing outside $WORK needs cleaning up.
echo "✓ Wrote 6 SVGs to $OUTDIR"
