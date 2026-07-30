// Renders captured terminal output (raw ANSI from `script`) to a static SVG.
//
// Models the screen as a list of line buffers rather than a cell grid: the app
// only ever emits `ESC[2K` + whole line + newline, or moves the cursor up by
// whole lines, so lines are the natural unit and wide glyphs (emoji) keep the
// same end-of-line drift they have in a real terminal.
//
// Usage: node render.mjs <in.ansi> <out.svg> [options]
//   --frame N|last   render the screen as it stood before the Nth cursor-up,
//                    which is how mid-flight states are captured (default: last)
//   --trim-top N     drop the first N rows, to crop away the list above output
//   --title T        caption for the window chrome; omit for no chrome
import { readFileSync, writeFileSync } from "node:fs";

const [inFile, outFile, ...rest] = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = rest.indexOf(`--${name}`);
  return i === -1 ? dflt : rest[i + 1];
};
const frameTarget = opt("frame", "last");
const title = opt("title", "");
const trimTop = Number(opt("trim-top", "0"));

const PALETTE = {
  30: "#3b4048", 31: "#e06c75", 32: "#98c379", 33: "#e5c07b",
  34: "#61afef", 35: "#c678dd", 36: "#56b6c2", 37: "#d7dae0",
  90: "#5c6370", 91: "#f07178", 92: "#b5e890", 93: "#f0d399",
  94: "#7cc4ff", 95: "#d99ae8", 96: "#67e0f5", 97: "#ffffff",
};
const FG_DEFAULT = "#d7dae0";

const data = readFileSync(inFile, "utf-8");
const lines = [[]]; // each line is an array of {text, style}
let row = 0;
let style = { fg: null, bold: false, dim: false };
let frameCount = 0;
let stopped = false;

const cur = () => {
  while (lines.length <= row) lines.push([]);
  return lines[row];
};

for (let i = 0; i < data.length && !stopped; i++) {
  const ch = data[i];

  if (ch === "\x1b" && data[i + 1] === "[") {
    const m = /^\x1b\[([0-9;]*)([A-Za-z])/.exec(data.slice(i));
    if (m) {
      const [all, params, verb] = m;
      i += all.length - 1;
      const nums = params === "" ? [] : params.split(";").map(Number);

      if (verb === "m") {
        for (const n of nums.length ? nums : [0]) {
          if (n === 0) style = { fg: null, bold: false, dim: false };
          else if (n === 1) style = { ...style, bold: true };
          else if (n === 2) style = { ...style, dim: true };
          else if (PALETTE[n]) style = { ...style, fg: PALETTE[n] };
        }
      } else if (verb === "A") {
        frameCount++;
        if (frameTarget !== "last" && frameCount === Number(frameTarget)) {
          stopped = true;
          break;
        }
        row = Math.max(0, row - (nums[0] ?? 1));
      } else if (verb === "B") {
        row += nums[0] ?? 1;
      } else if (verb === "K") {
        cur().length = 0;
      }
      continue;
    }
  }

  if (ch === "\n") { row++; cur(); continue; }
  if (ch === "\r") continue;
  if (ch === "\x1b") continue;

  const line = cur();
  const last = line[line.length - 1];
  if (last && last.fg === style.fg && last.bold === style.bold && last.dim === style.dim) {
    last.text += ch;
  } else {
    line.push({ text: ch, ...style });
  }
}

// Trailing blank lines are just the cursor parked below the last frame.
while (lines.length && lines[lines.length - 1].every((s) => !s.text.trim())) lines.pop();
const body = lines.slice(trimTop);

const CHAR_W = 8.4, LINE_H = 20, FONT = 14;
const PAD_X = 18, PAD_TOP = title ? 46 : 18, PAD_BOT = 18;

const widthCols = Math.max(
  title.length + 6,
  ...body.map((l) => l.reduce((n, s) => n + [...s.text].length, 0)),
);
const W = Math.ceil(PAD_X * 2 + widthCols * CHAR_W);
const H = Math.ceil(PAD_TOP + body.length * LINE_H + PAD_BOT);

const esc = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

const rows = body.map((spans, idx) => {
  const y = PAD_TOP + idx * LINE_H + FONT;
  const inner = spans
    .filter((s) => s.text.length)
    .map((s) => {
      const attrs = [`fill="${s.fg ?? FG_DEFAULT}"`];
      if (s.bold) attrs.push('font-weight="700"');
      if (s.dim) attrs.push('opacity="0.62"');
      return `<tspan ${attrs.join(" ")}>${esc(s.text)}</tspan>`;
    })
    .join("");
  return `  <text x="${PAD_X}" y="${y}" xml:space="preserve">${inner}</text>`;
}).join("\n");

const chrome = title
  ? `  <rect x="0" y="0" width="${W}" height="34" fill="#181b24"/>
  <circle cx="20" cy="17" r="5.5" fill="#e06c75"/>
  <circle cx="38" cy="17" r="5.5" fill="#e5c07b"/>
  <circle cx="56" cy="17" r="5.5" fill="#98c379"/>
  <text x="${W / 2}" y="22" text-anchor="middle" font-size="12.5" fill="#8b93a7">${esc(title)}</text>`
  : "";

writeFileSync(
  outFile,
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, 'DejaVu Sans Mono', monospace" font-size="${FONT}">
  <rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="#1e222d"/>
${chrome}
${rows}
</svg>
`,
);

console.error(`${outFile}: ${body.length} lines, ${widthCols} cols, ${frameCount} frames seen`);
