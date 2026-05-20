# git-worktree-clean

An interactive CLI tool for cleaning up [git worktrees](https://git-scm.com/docs/git-worktree). Lists your worktrees, lets you select which ones to remove, and deletes the associated branches — all with a nice terminal UI.

## Features

- Interactive checkbox selector to pick worktrees for removal
- Marks dirty worktrees (uncommitted changes) and asks for confirmation before force-removing
- Removes the associated branch after removing a worktree
- Parallel removal with concurrent progress spinners
- Prunes stale worktree references when done

## Install

```sh
git clone git@github.com:adrianbw/git-worktree-clean.git
cd git-worktree-clean
./install.sh
```

This installs dependencies with `pnpm`, then symlinks `bin/git-worktree-clean` into `~/.local/bin/`. Make sure `~/.local/bin` is on your `PATH`. Requires [pnpm](https://pnpm.io/installation) (or corepack).

## Usage

Run from inside any git repository:

```sh
git-worktree-clean
```

You'll see a checkbox list of all worktrees (excluding the main one). Select the ones you want to remove, confirm any that have uncommitted changes, and the tool handles the rest.

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

## How it works internally

1. Checks you're inside a git repo
2. Runs `git worktree list --porcelain` and parses the output, skipping the main worktree
3. Checks each worktree for uncommitted changes via `git status --porcelain`
4. Presents an interactive checkbox list (via [@inquirer/prompts](https://www.npmjs.com/package/@inquirer/prompts))
5. For dirty worktrees, prompts for y/n confirmation before force-removing
6. Removes selected worktrees in parallel (`git worktree remove`), deletes their branches (`git branch -D`), and shows progress with animated spinners
7. Runs `git worktree prune` to clean up stale references

## Requirements

- Node.js (for `tsx`)
- Git
