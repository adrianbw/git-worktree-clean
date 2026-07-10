# git-worktree-clean

An interactive CLI tool for cleaning up [git worktrees](https://git-scm.com/docs/git-worktree). Lists your worktrees, lets you select which ones to remove, and deletes the associated branches — all with a custom terminal UI. Also doubles as a worktree picker: hit `o` on any row to `cd` your shell straight into that worktree.

## Features

### Interactive selection TUI
- Custom-built keyboard-driven TUI (no external prompt library)
- Key bindings:
  - `↑` / `↓` — move cursor
  - `space` — toggle selection on the cursor row
  - `o` — open (cd into) the worktree under the cursor and exit
  - `enter` — confirm selection and remove the checked worktrees
  - `q` or `ctrl-c` — quit without doing anything
- Main worktree is always hidden from the list — you can never accidentally select it

### Worktree status tags
Each row shows visual tags so you know what you're about to delete:
- `⚠ dirty` — uncommitted changes in the working tree
- `🔒 locked` — the worktree is locked (with the lock reason if one was given)
- `✓ merged` — the worktree's branch has a merged PR on GitHub (detected via the `gh` CLI)
- `✕ closed` — the worktree's branch has a PR that was closed without merging
- PR-status checks (both `merged` and `closed`) run in parallel before the TUI opens, with a 10-second timeout per branch; if `gh` isn't installed or the lookup fails, the tag is simply omitted — it never blocks the cleanup flow.
- Detached-HEAD worktrees are shown as `(detached)`

### Safe removal
- Clean worktrees are removed in one go after the user confirms with enter
- Dirty and/or locked worktrees prompt a per-worktree `y/n` confirmation before being force-removed (`--force` once for dirty, twice for locked, as `git worktree remove` requires)
- After a worktree is removed, its branch is deleted with `git branch -D`. If branch deletion fails (e.g., it's checked out elsewhere), the worktree is still reported as removed and the branch failure is surfaced as a warning rather than an error.
- Final `git worktree prune` cleans up any stale references

### Parallel removal with live progress
- Selected worktrees are removed in parallel
- Each removal gets its own animated spinner line (braille frames, updated in place via ANSI cursor moves)
- Spinners transition to `✓` (success), `✗` (failure), or `⚠` (partial — worktree gone but branch couldn't be deleted)

### Worktree picker (`o` key)
Press `o` on any row to `cd` your parent shell into that worktree's path and exit. This is implemented by:
1. The shell function (installed into `~/.zshrc` / `~/.bashrc` by `install.sh`) creates a temp file and passes its path to the binary via the `GIT_WORKTREE_CLEAN_CD_FILE` env var.
2. When you press `o`, the binary writes the chosen worktree path to that file and exits.
3. The shell function reads the file and `cd`s into it.

If the shell function isn't installed (e.g., you ran the binary directly), pressing `o` prints the chosen path along with a hint to re-run `install.sh`, since a subprocess can't change its parent shell's directory on its own.

### Self-protection against cwd-pulled-from-under-you
Before doing anything, the tool `chdir`s into the main worktree. That way, if you happen to be sitting inside a worktree you're about to remove, the removal doesn't break subsequent git commands (or leave your shell stranded). If your original shell `cwd` was inside a removed worktree, the tool prints a final reminder telling you to `cd` into the main worktree.

## Install

```sh
git clone git@github.com:adrianbw/git-worktree-clean.git
cd git-worktree-clean
./install.sh
```

`install.sh`:
1. Runs `pnpm install` (or `corepack pnpm install` as a fallback) to fetch dependencies — no build step needed.
2. Symlinks `bin/git-worktree-clean` into `~/.local/bin/`.
3. Appends a small shell function to `~/.zshrc` and `~/.bashrc` so the `o` (open) key can `cd` your parent shell. The block is idempotent — re-running `install.sh` won't add it twice.
4. Warns if `~/.local/bin` isn't on your `PATH`.

Requirements: `git`, Node.js (for `tsx`), and [pnpm](https://pnpm.io/installation) (or corepack). The `gh` CLI is optional and only used to detect merged/closed PRs.

## Usage

From inside any git repository:

```sh
git-worktree-clean
```

You'll see a checkbox list of every worktree except the main one. Select the ones you want removed and press enter — or press `o` to jump into the worktree under the cursor.

## How the launcher script works

The file at `bin/git-worktree-clean` (symlinked into your `~/.local/bin/`) is a small bash wrapper whose job is to locate the repo checkout and run the TypeScript source with `tsx`. Here's what it does step by step:

```bash
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$(cd "$(dirname "$SOURCE")/.." && pwd)"
exec "$DIR/node_modules/.bin/tsx" "$DIR/src/main.ts" "$@"
```

1. **Resolve symlinks** — `~/.local/bin/git-worktree-clean` is a symlink pointing to `bin/git-worktree-clean` inside the repo. The `while` loop follows the chain of symlinks until it reaches the real file. At each step it resolves relative symlink targets into absolute paths.
2. **Find the repo root** — Once it has the real file path (inside `bin/`), it goes up one directory (`/..`) to get the repo root and stores it in `DIR`.
3. **Run the TypeScript source** — It `exec`s `tsx` (a TypeScript runner) from the repo's local `node_modules`, passing `src/main.ts` and forwarding any CLI arguments (`$@`).

The net effect: you can call `git-worktree-clean` from anywhere on your system, and it always runs the source code from the cloned repo using the repo's own dependencies — no global installs or build step needed.

## How the shell-function wrapper works

`install.sh` appends this function to your shell rc files so the `o` (open) key can change your shell's working directory:

```bash
git-worktree-clean() {
  local cd_file
  cd_file="$(mktemp -t gwtc.XXXXXX)" || return 1
  GIT_WORKTREE_CLEAN_CD_FILE="$cd_file" command git-worktree-clean "$@"
  local rc=$?
  if [ -s "$cd_file" ]; then
    cd "$(cat "$cd_file")" || true
  fi
  rm -f "$cd_file"
  return $rc
}
```

It creates a temp file, hands its path to the binary via `GIT_WORKTREE_CLEAN_CD_FILE`, and after the binary exits, `cd`s into whatever path the binary wrote to that file. `command git-worktree-clean` bypasses the function itself so we actually invoke the binary on `PATH`.

## How it works internally

1. Checks you're inside a git repo (`git rev-parse --git-dir`)
2. Runs `git worktree list --porcelain` and parses the porcelain output into structured worktree records — pulling out the path, HEAD, branch ref, and any `locked` reason. The first block (the main worktree) is skipped from the picker but its path is kept for `chdir`-ing into safely.
3. For each worktree, runs `git -C <path> status --porcelain` to detect uncommitted changes
4. In parallel, queries `gh pr list --head <branch> --state all` for each branch and reads the most recent PR's state to flag `merged` and `closed` PRs (10s timeout, soft-fails)
5. Renders the TUI; user toggles selections, opens a worktree, or quits
6. For each selected dirty/locked worktree, prompts `y/n` to confirm force removal
7. Removes selected worktrees in parallel (`git worktree remove`, with `--force` for dirty and `--force --force` for locked), deletes their branches (`git branch -D`), and shows progress with animated spinners
8. Runs `git worktree prune` to clean up stale references
9. Warns if the shell's original `cwd` was inside a removed worktree

## Project layout

- `bin/git-worktree-clean` — bash launcher (resolves symlinks, execs `tsx`)
- `install.sh` — installs deps, symlinks the binary, adds the shell function
- `src/main.ts` — orchestrates the flow
- `src/git.ts` — git command wrappers (list, status, PR-state check, remove, branch delete, prune)
- `src/ui.ts` — the selection TUI and the dirty/locked confirmation prompt
- `src/spinner.ts` — the multi-line animated spinner group used during parallel removal
- `src/types.ts` — the `Worktree` record shape

## Requirements

- Git
- Node.js (for `tsx`)
- pnpm (or corepack) — install-time only
- `gh` CLI (optional, only used to detect merged/closed PRs)
