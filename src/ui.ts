import type { Worktree } from "./types.js";

export type TuiResult =
  | { type: "select"; worktrees: Worktree[] }
  | { type: "open"; worktree: Worktree }
  | { type: "quit" };

const colorEnabled =
  !process.env.NO_COLOR && process.stderr.isTTY;

const c = (code: string, s: string) =>
  colorEnabled ? `\x1b[${code}m${s}\x1b[0m` : s;

const dim = (s: string) => c("2", s);
const bold = (s: string) => c("1", s);
const cyan = (s: string) => c("96", s);
const green = (s: string) => c("32", s);
const yellow = (s: string) => c("33", s);
const red = (s: string) => c("31", s);

const HEADER = dim(
  "Select worktrees (↑/↓ move, space toggle, c clean merged/closed, o open, enter confirm, q quit):",
);

function formatRow(wt: Worktree, isCursor: boolean, isSelected: boolean): string {
  const tags: string[] = [];
  if (wt.isDirty) tags.push(yellow("⚠ dirty"));
  if (wt.lockReason !== null) tags.push(red("🔒 locked"));
  if (wt.prState === "MERGED") tags.push(green("✓ merged"));
  if (wt.prState === "CLOSED") tags.push(red("✕ closed"));
  const suffix = tags.length ? ` ${tags.join(" ")}` : "";

  const branchText = wt.branch ?? dim("(detached)");
  const label = isCursor && wt.branch ? bold(branchText) : branchText;

  const cursor = isCursor ? cyan("❯") : " ";
  const box = isSelected ? green("[x]") : dim("[ ]");
  return `${cursor} ${box} ${label}${suffix}`;
}

export interface Tui {
  /** Resolves once the user picks an action. */
  result: Promise<TuiResult>;
  /** Repaint — call after mutating worktree state in the background. */
  refresh: () => void;
}

/**
 * Paints the worktree list and starts handling input immediately. Rows are read
 * live from `worktrees`, so a caller resolving `isDirty` / `prState` in the
 * background just mutates them and calls `refresh()`.
 */
export function runTui(worktrees: Worktree[]): Tui {
  let cursor = 0;
  const selected = new Set<number>();
  let drawnLines = 0;
  let notice: string | null = null;
  let done = false;

  const footer = (): string | null => {
    if (notice !== null) return yellow(notice);
    const pending: string[] = [];
    const dirty = worktrees.filter((wt) => wt.isDirty === null).length;
    const prs = worktrees.filter((wt) => wt.prState === "pending").length;
    if (dirty > 0) pending.push(`status ${dirty}`);
    if (prs > 0) pending.push(`PRs ${prs}`);
    return pending.length ? dim(`  ⋯ checking ${pending.join(", ")}`) : null;
  };

  const draw = () => {
    const out = process.stderr;
    if (drawnLines > 0) out.write(`\x1b[${drawnLines}A`);
    const rows = [HEADER];
    for (let i = 0; i < worktrees.length; i++) {
      rows.push(formatRow(worktrees[i], i === cursor, selected.has(i)));
    }
    const f = footer();
    if (f !== null) rows.push(f);
    for (const r of rows) out.write(`\x1b[2K${r}\n`);
    // Clear any lines the previous, taller frame left behind (the footer
    // disappears once every background check has landed).
    for (let i = rows.length; i < drawnLines; i++) out.write("\x1b[2K\n");
    if (rows.length < drawnLines) {
      out.write(`\x1b[${drawnLines - rows.length}A`);
    }
    drawnLines = rows.length;
  };

  draw();

  const result = new Promise<TuiResult>((resolve) => {
    const stdin = process.stdin;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const cleanup = () => {
      done = true;
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };

    const onData = (chunk: Buffer) => {
      const key = chunk.toString();

      // Any keypress dismisses a transient notice.
      if (notice !== null) notice = null;

      if (key === "\x03" || key === "q") {
        cleanup();
        resolve({ type: "quit" });
        return;
      }
      if (key === "\x1b[A") {
        cursor = (cursor - 1 + worktrees.length) % worktrees.length;
        draw();
        return;
      }
      if (key === "\x1b[B") {
        cursor = (cursor + 1) % worktrees.length;
        draw();
        return;
      }
      if (key === " ") {
        if (selected.has(cursor)) selected.delete(cursor);
        else selected.add(cursor);
        draw();
        return;
      }
      if (key === "o") {
        cleanup();
        resolve({ type: "open", worktree: worktrees[cursor] });
        return;
      }
      if (key === "c") {
        // Select every worktree whose PR is merged or closed and confirm
        // immediately. Dirty/locked ones among them still get a per-worktree
        // force-removal prompt downstream, so this stays safe.
        //
        // Refuse while PR lookups are outstanding — acting on a partial set
        // would silently skip worktrees that are in fact merged.
        if (worktrees.some((wt) => wt.prState === "pending")) {
          notice = "  Still checking PR status — try again in a moment.";
          draw();
          return;
        }
        const targets = worktrees.filter(
          (wt) => wt.prState === "MERGED" || wt.prState === "CLOSED",
        );
        if (targets.length === 0) {
          notice = "  No merged or closed PRs to clean up.";
          draw();
          return;
        }
        cleanup();
        resolve({ type: "select", worktrees: targets });
        return;
      }
      if (key === "\r" || key === "\n") {
        cleanup();
        resolve({
          type: "select",
          worktrees: [...selected].sort((a, b) => a - b).map((i) => worktrees[i]),
        });
        return;
      }

      // Unhandled key: repaint only if we just cleared a notice.
      draw();
    };

    stdin.on("data", onData);
  });

  return {
    result,
    // Ignore late updates once the TUI has torn down, otherwise a resolving
    // background check would repaint over whatever is on screen next.
    refresh: () => {
      if (!done) draw();
    },
  };
}

export function confirmForceRemoval(wt: Worktree): Promise<boolean> {
  const label = wt.branch ?? wt.path;
  const reasons: string[] = [];
  if (wt.isDirty) reasons.push("has uncommitted changes");
  if (wt.lockReason !== null) {
    reasons.push(
      wt.lockReason ? `is locked (${wt.lockReason})` : "is locked",
    );
  }
  process.stdout.write(
    `⚠ "${label}" ${reasons.join(" and ")}. Force remove? (y/n) `,
  );

  return new Promise((resolve) => {
    const { stdin } = process;
    const wasRaw = stdin.isRaw;
    stdin.setRawMode(true);
    stdin.resume();

    const onData = (key: Buffer) => {
      const ch = key.toString().toLowerCase();
      if (ch === "y") {
        process.stdout.write("y\n");
        cleanup();
        resolve(true);
      } else if (ch === "n") {
        process.stdout.write("n\n");
        cleanup();
        resolve(false);
      } else if (ch === "\x03") {
        process.stdout.write("\n");
        cleanup();
        process.exit(130);
      }
    };

    const cleanup = () => {
      stdin.removeListener("data", onData);
      stdin.setRawMode(wasRaw ?? false);
      stdin.pause();
    };

    stdin.on("data", onData);
  });
}
