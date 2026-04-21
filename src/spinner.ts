const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const INTERVAL = 80;

export interface SpinnerLine {
  update(text: string): void;
  succeed(text: string): void;
  fail(text: string): void;
  warn(text: string): void;
}

/**
 * Renders multiple concurrent spinner lines that update in-place.
 * Call `create()` to reserve a line, then update/succeed/fail it.
 * Call `stop()` when all work is done to clean up the interval.
 */
export function createSpinnerGroup() {
  const lines: Array<{
    text: string;
    frame: number;
    done: boolean;
    symbol: string | null;
  }> = [];

  let intervalId: ReturnType<typeof setInterval> | null = null;

  function render() {
    // Move cursor up to overwrite previous render
    if (lines.length > 0) {
      process.stderr.write(`\x1b[${lines.length}A`);
    }
    for (const line of lines) {
      const prefix = line.done
        ? line.symbol!
        : FRAMES[line.frame % FRAMES.length];
      if (!line.done) line.frame++;
      // Clear line, write content
      process.stderr.write(`\x1b[2K  ${prefix} ${line.text}\n`);
    }
  }

  function start() {
    if (intervalId) return;
    intervalId = setInterval(render, INTERVAL);
  }

  function stop() {
    if (intervalId) {
      clearInterval(intervalId);
      intervalId = null;
      render(); // Final render to show completed state
    }
  }

  function create(text: string): SpinnerLine {
    const entry = { text, frame: 0, done: false, symbol: null as string | null };
    lines.push(entry);
    // Print a blank line to reserve space
    process.stderr.write(`\x1b[2K  ${FRAMES[0]} ${text}\n`);
    start();

    return {
      update(newText: string) {
        entry.text = newText;
      },
      succeed(newText: string) {
        entry.text = newText;
        entry.done = true;
        entry.symbol = "✓";
      },
      fail(newText: string) {
        entry.text = newText;
        entry.done = true;
        entry.symbol = "✗";
      },
      warn(newText: string) {
        entry.text = newText;
        entry.done = true;
        entry.symbol = "⚠";
      },
    };
  }

  return { create, stop };
}
