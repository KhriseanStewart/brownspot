import { stdout as output } from "node:process";

const isTTY = Boolean(output.isTTY);
const noColor = Boolean(process.env.NO_COLOR);
export const useColor = isTTY && !noColor;

function paint(code: string) {
  return (s: string) => (useColor ? `\x1b[${code}m${s}\x1b[0m` : s);
}

export const style = {
  bold: paint("1"),
  dim: paint("2"),
  italic: paint("3"),
  underline: paint("4"),
  strikethrough: paint("9"),
  red: paint("31"),
  green: paint("32"),
  yellow: paint("33"),
  blue: paint("34"),
  magenta: paint("35"),
  cyan: paint("36"),
  gray: paint("90"),
  brightCyan: paint("96"),
  brightMagenta: paint("95"),
};

export function stripAnsi(s: string): string {
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

export function firstLine(s: string, max = 100): string {
  const line = s.split("\n")[0] ?? "";
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

export function spinner(text: string) {
  if (!useColor) {
    console.log(style.dim(text));
    return { stop: () => {} };
  }
  const frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
  let i = 0;
  const id = setInterval(() => {
    i = (i + 1) % frames.length;
    process.stdout.write(`\r${style.cyan(frames[i])} ${style.dim(text)}`);
  }, 80);
  return {
    stop: () => {
      clearInterval(id);
      process.stdout.write(`\r\x1b[K`);
    },
  };
}

export function printBanner(workspace: string, model: string) {
  const rows = [
    style.bold(style.brightCyan("● BrownSpot")),
    "",
    `${style.dim("workspace")}  ${workspace}`,
    `${style.dim("model")}      ${model}`,
  ];
  const width = Math.max(...rows.map((r) => stripAnsi(r).length)) + 2;
  const top = `╭${"─".repeat(width)}╮`;
  const bottom = `╰${"─".repeat(width)}╯`;
  console.log(style.gray(top));
  for (const r of rows) {
    const pad = Math.max(width - stripAnsi(r).length - 1, 0);
    console.log(`${style.gray("│")} ${r}${" ".repeat(pad)}${style.gray("│")}`);
  }
  console.log(style.gray(bottom));
  console.log(style.dim('Type "exit" to quit.\n'));
}

/**
 * Very small Markdown -> ANSI renderer for model output in the terminal.
 * Supports: headers, bullet/numbered/task lists, blockquotes, horizontal
 * rules, fenced code blocks, simple tables, inline code, bold, italic,
 * bold+italic, strikethrough, links, images, and escaped characters.
 * Not a full CommonMark implementation — just enough to make chat
 * responses readable. Footnote definitions, definition lists, and raw
 * inline HTML are passed through as literal text by design.
 */
export function renderMarkdown(text: string): string {
  if (!useColor) return text; // keep plain output plain (e.g. piped/NO_COLOR)

  const lines = text.split("\n");
  const out: string[] = [];
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const fence = line.match(/^\s*```\s*(\S*)\s*$/);
    if (fence) {
      inCodeBlock = !inCodeBlock;
      out.push(style.dim(inCodeBlock ? `┌─ ${fence[1] || "code"}` : "└─"));
      continue;
    }
    if (inCodeBlock) {
      out.push(style.gray(`│ ${line}`));
      continue;
    }
    if (isTableSeparator(line)) continue; // dropped; header row already styled
    if (isTableRow(line)) {
      const isHeader = isTableSeparator(lines[i + 1] ?? "");
      out.push(renderTableRow(line, isHeader));
      continue;
    }
    out.push(renderLine(line));
  }
  return out.join("\n");
}

function isTableSeparator(line: string): boolean {
  return /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(line);
}

function isTableRow(line: string): boolean {
  return /\|/.test(line) && !isTableSeparator(line) && line.trim().length > 0;
}

function renderTableRow(line: string, isHeader: boolean): string {
  const cells = line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((c) => c.trim());
  const rendered = cells.map((c) => {
    const inline = applyInline(c);
    return isHeader ? style.bold(inline) : inline;
  });
  return rendered.join(style.dim(" │ "));
}

function renderLine(line: string): string {
  const heading = line.match(/^(#{1,6})\s+(.*)$/);
  if (heading) {
    const text = applyInline(heading[2] ?? "");
    return heading[1]!.length === 1
      ? style.bold(style.brightCyan(text))
      : style.bold(style.cyan(text));
  }

  const quote = line.match(/^\s*>\s?(.*)$/);
  if (quote) return style.dim(style.italic(`▏ ${applyInline(quote[1] ?? "")}`));

  if (/^\s*([-*_]\s*){3,}$/.test(line) && line.trim().length >= 3) {
    return style.dim("─".repeat(40));
  }

  const task = line.match(/^(\s*)[-*+]\s+\[([ xX])\]\s+(.*)$/);
  if (task) {
    const checked = (task[2] ?? "").toLowerCase() === "x";
    const box = checked ? style.green("☑") : style.dim("☐");
    return `${task[1]}${box} ${applyInline(task[3] ?? "")}`;
  }

  const bullet = line.match(/^(\s*)[-*+]\s+(.*)$/);
  if (bullet) {
    return `${bullet[1]}${style.brightCyan("•")} ${applyInline(bullet[2] ?? "")}`;
  }

  const numbered = line.match(/^(\s*)(\d+)[.)]\s+(.*)$/);
  if (numbered) {
    return `${numbered[1]}${style.brightCyan(`${numbered[2]}.`)} ${applyInline(numbered[3] ?? "")}`;
  }

  return applyInline(line);
}

/**
 * Inline styling: escaped chars, images, links, `code`, ~~strike~~,
 * ***bold italic***, **bold**, *italic* — applied in that order so code
 * spans and escapes are protected from later passes.
 */
function applyInline(text: string): string {
  // Escaped characters (\* \_ \` etc.) are pulled out first so they don't
  // trigger emphasis/other syntax, then restored literally at the end.
  const escapes: string[] = [];
  let t = text.replace(/\\([\\`*_{}[\]()#+\-.!~])/g, (_, c: string) => {
    escapes.push(c);
    return `\u0000${escapes.length - 1}\u0000`;
  });

  t = t.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_, alt: string, url: string) =>
    style.dim(`[image: ${alt || url}]`),
  );
  t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label: string, url: string) =>
    `${style.underline(style.blue(label))}${style.dim(` (${url})`)}`,
  );

  t = t.replace(/`([^`]+)`/g, (_, code: string) => style.yellow(code));
  t = t.replace(/~~([^~]+)~~/g, (_, s: string) => style.strikethrough(s));

  t = t.replace(
    /\*\*\*([^*]+)\*\*\*|___([^_]+)___/g,
    (_, a: string, b: string) => style.bold(style.italic(a ?? b)),
  );
  t = t.replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, (_, a: string, b: string) =>
    style.bold(a ?? b),
  );
  t = t.replace(
    /(?<!\*)\*([^*]+)\*(?!\*)|(?<!_)_([^_]+)_(?!_)/g,
    (_, a: string, b: string) => style.italic(a ?? b),
  );

  t = t.replace(/\u0000(\d+)\u0000/g, (_, i: string) => escapes[Number(i)] ?? "");
  return t;
}
