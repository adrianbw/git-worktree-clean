# Screenshot harness

Regenerates the SVGs in `docs/` that the top-level README embeds.

```sh
pnpm screenshots
```

Requires `git`, Node, and `script` (present on macOS and most Linux distros). It
writes nothing outside `docs/` and a temp directory.

## What it does

1. **Builds a throwaway repo** under `mktemp -d` with seven worktrees chosen to
   cover every badge at once: three merged, one closed, one with an open PR, one
   dirty, one locked (with a reason), and one detached. That build lives in
   `demo-repo.sh`, which is also runnable on its own (`demo-repo.sh <dir>`) when
   you want the same fixture to try something against by hand.
2. **Runs the real binary under a pty.** A pty is not optional — the TUI needs
   raw-mode stdin, and color switches itself off when stderr isn't a TTY.
   `script` provides one; keystrokes are piped in with `sleep`s between them to
   let background work land (or deliberately not land) first. The `--auto`
   capture takes no keystrokes, but still pipes in a `sleep`: an stdin that
   closes first makes the pty echo a stray `^D` into the capture.
3. **Renders the captured ANSI to SVG** with `render.mjs`.

Everything in the screenshots is genuine output — real `git worktree remove`,
real `git status`, real branch deletion. The one exception is `gh`: the demo repo
has no GitHub remote, so `gh-stub/gh` shadows it on `PATH` and maps the demo
branch names to PR states.

## Capturing a moment mid-flight

The interesting states are transient, so `render.mjs` can stop replaying partway
through a capture. `--frame N` renders the screen as it stood just before the
Nth cursor-up escape, i.e. after N-1 repaints — that's how `checking.svg` catches
the `⋯ checking …` footer before the badges arrive.

Reaching the `gated.svg` state needs the opposite trick: `GH_STUB_DELAY` slows
the stubbed PR lookups down far enough that `c` can be pressed while they're
still outstanding.

## Why a hand-rolled renderer

`render.mjs` is ~150 lines and has no dependencies, which beat adding a toolchain
(`asciinema` + `agg`, `vhs`, `freeze`) for six images. It models the screen as a
list of line buffers rather than a cell grid, which is sound here because the app
only ever emits `ESC[2K` + a whole line + newline, or moves the cursor up by whole
lines. It handles just the escapes the app actually uses: `ESC[2K`, `ESC[{n}A/B`,
and SGR colors. Feeding it arbitrary terminal output will not work.

SVG rather than PNG or GIF keeps the images a few KB each, crisp at any zoom, and
diffable in review.
