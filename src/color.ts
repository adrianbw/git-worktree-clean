/**
 * ANSI helpers bound to one output stream. Colour is dropped when that stream
 * isn't a TTY (piping or redirecting gives plain text) and when NO_COLOR is set.
 */
export function createColors(stream: { isTTY?: boolean }) {
  const enabled = !process.env.NO_COLOR && Boolean(stream.isTTY);
  const c = (code: string, s: string) =>
    enabled ? `\x1b[${code}m${s}\x1b[0m` : s;

  return {
    dim: (s: string) => c("2", s),
    bold: (s: string) => c("1", s),
    cyan: (s: string) => c("96", s),
    green: (s: string) => c("32", s),
    yellow: (s: string) => c("33", s),
    red: (s: string) => c("31", s),
  };
}
