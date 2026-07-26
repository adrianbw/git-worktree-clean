# git-worktree-clean

An interactive CLI tool for cleaning up [git worktrees](https://git-scm.com/docs/git-worktree). Lists your worktrees, lets you select which ones to remove, and deletes the associated branches — all with a custom terminal UI. Also doubles as a worktree picker: hit `o` on any row to `cd` your shell straight into that worktree.

## Features

### Interactive selection TUI
- Custom-built keyboard-driven TUI (no external prompt library)
- Key bindings:
  - `↑` / `↓` — move cursor
  - `space` — toggle selection on the cursor row
  - `c` — clean: select every merged/closed worktree and confirm immediately (dirty/locked ones still prompt for force removal)
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
- Detached-HEAD worktrees are shown as `(detached)`

The `dirty`, `merged`, and `closed` tags are all resolved **after** the list is on screen (see [Startup](#startup)), so they pop in a moment after the TUI opens. A `⋯ checking …` footer shows what's still outstanding and disappears once everything has landed. PR lookups use a 10-second timeout per branch; if `gh` isn't installed or the lookup fails, the tag is simply omitted — it never blocks the cleanup flow.

Two places wait for this background work, so a fast keypress can never act on incomplete data:
- `c` (clean merged/closed) refuses to run while any PR lookup is outstanding — acting on a partial set would silently skip worktrees that are in fact merged.
- `enter` waits for the `git status` checks before prompting, so a dirty worktree always gets its force-removal confirmation.

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
1. Runs `pnpm install` (or `corepack pnpm install` as a fallback) to fetch dependencies.
2. Runs `pnpm build` to compile `src/` to `dist/` — this is what keeps startup fast (see [Startup](#startup)).
3. Symlinks `bin/git-worktree-clean` into `~/.local/bin/`.
4. Appends a small shell function to `~/.zshrc` and `~/.bashrc` so the `o` (open) key can `cd` your parent shell. The block is idempotent — re-running `install.sh` won't add it twice.
5. Warns if `~/.local/bin` isn't on your `PATH`.

Requirements: `git`, Node.js, and [pnpm](https://pnpm.io/installation) (or corepack). The `gh` CLI is optional and only used to detect merged/closed PRs.

## Usage

From inside any git repository:

```sh
git-worktree-clean
```

You'll see a checkbox list of every worktree except the main one. Select the ones you want removed and press enter — or press `o` to jump into the worktree under the cursor.

## How the launcher script works

The file at `bin/git-worktree-clean` (symlinked into your `~/.local/bin/`) is a small bash wrapper whose job is to locate the repo checkout and run the app. Here's what it does step by step:

```bash
SOURCE="$0"
while [ -L "$SOURCE" ]; do
  DIR="$(cd "$(dirname "$SOURCE")" && pwd)"
  SOURCE="$(readlink "$SOURCE")"
  [[ "$SOURCE" != /* ]] && SOURCE="$DIR/$SOURCE"
done
DIR="$(cd "$(dirname "$SOURCE")/.." && pwd)"

BUILT="$DIR/dist/main.js"
if [ -f "$BUILT" ] && [ -z "$(find "$DIR/src" -name '*.ts' -newer "$BUILT" -print -quit)" ]; then
  exec node "$BUILT" "$@"
fi

exec "$DIR/node_modules/.bin/tsx" "$DIR/src/main.ts" "$@"
```

1. **Resolve symlinks** — `~/.local/bin/git-worktree-clean` is a symlink pointing to `bin/git-worktree-clean` inside the repo. The `while` loop follows the chain of symlinks until it reaches the real file. At each step it resolves relative symlink targets into absolute paths.
2. **Find the repo root** — Once it has the real file path (inside `bin/`), it goes up one directory (`/..`) to get the repo root and stores it in `DIR`.
3. **Prefer the compiled build** — If `dist/main.js` exists and no `.ts` file under `src/` is newer than it, run it with plain `node`. This skips `tsx`'s on-the-fly transpile, which is most of the fixed startup cost.
4. **Otherwise fall back to `tsx`** — If `dist/` is missing or stale, it runs the TypeScript source directly, so editing `src/` always takes effect without a rebuild (you just pay the transpile cost until you run `pnpm build`).

The net effect: you can call `git-worktree-clean` from anywhere on your system, and it always runs the code from the cloned repo using the repo's own dependencies — fast when built, still correct when not.

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
3. **Renders the TUI immediately**, with `isDirty` and `prState` still unresolved
4. In the background, and all concurrently:
   - `git -C <path> status --porcelain` per worktree to detect uncommitted changes
   - `gh pr list --head <branch> --state all` per branch, reading the most recent PR's state to flag `merged` and `closed` (10s timeout, soft-fails)

   Each result mutates its worktree record and repaints the affected row.
5. User toggles selections, opens a worktree, or quits
6. Waits for the `status` checks, then prompts `y/n` per selected dirty/locked worktree to confirm force removal
7. Removes selected worktrees in parallel (`git worktree remove`, with `--force` for dirty and `--force --force` for locked), deletes their branches (`git branch -D`), and shows progress with animated spinners
8. Runs `git worktree prune` to clean up stale references
9. Warns if the shell's original `cwd` was inside a removed worktree

### Startup

Nothing slow sits between launch and the first frame. Three things make that work:

- **The list is painted before anything is known about it.** Parsing `git worktree list --porcelain` takes ~15ms; the per-worktree `git status` and `gh` calls are the slow part, so they run *after* the TUI is up rather than before it, and rows gain their tags as results arrive.
- **The background checks all run concurrently** rather than one worktree at a time.
- **`git status` bails early.** Detecting "dirty" only needs to know whether there is *any* output, so it's spawned rather than buffered and killed on the first byte — no need to finish walking the tree. (This also removes a latent bug: a worktree dirty enough to overflow the old 1MB `execSync` buffer used to be silently reported clean.)

On a monorepo with 9 worktrees, time-to-first-frame went from **~3.7s to ~140ms** (~27×), and full decoration from ~3.7s to ~1.3s. Roughly 170ms of the fixed cost came from `tsx` transpiling on every run, which the [compiled build](#how-the-launcher-script-works) removes.

## Project layout

- `bin/git-worktree-clean` — bash launcher (resolves symlinks, prefers `dist/`, falls back to `tsx`)
- `install.sh` — installs deps, builds, symlinks the binary, adds the shell function
- `src/main.ts` — orchestrates the flow and drives the background status/PR checks
- `src/git.ts` — git command wrappers (list, dirty check, PR-state check, remove, branch delete, prune)
- `src/ui.ts` — the selection TUI and the dirty/locked confirmation prompt
- `src/spinner.ts` — the multi-line animated spinner group used during parallel removal
- `src/types.ts` — the `Worktree` record shape

## Development

```sh
pnpm build      # compile src/ -> dist/ (what the launcher prefers)
pnpm typecheck  # tsc --noEmit
```

You don't have to rebuild while iterating — the launcher notices when `src/` is newer than `dist/` and falls back to `tsx`. Run `pnpm build` when you're done to get the faster startup back.

## Requirements

- Git
- Node.js
- pnpm (or corepack) — install/build-time only
- `gh` CLI (optional, only used to detect merged/closed PRs)
