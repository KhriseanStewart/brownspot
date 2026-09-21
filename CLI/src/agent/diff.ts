import { style } from "./style.ts";

export type DiffStats = { added: number; removed: number; summary: string };

/** Line-based LCS → ops for unified diff. */
function lineOps(a: string[], b: string[]): Array<{ t: "eq" | "del" | "add"; line: string }> {
  const n = a.length;
  const m = b.length;
  // Cap LCS matrix size for huge files — fall back to full replace hunk
  if (n * m > 2_000_000 || n + m > 8_000) {
    const ops: Array<{ t: "eq" | "del" | "add"; line: string }> = [];
    for (const line of a) ops.push({ t: "del", line });
    for (const line of b) ops.push({ t: "add", line });
    return ops;
  }
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i]![j] =
        a[i] === b[j] ? (dp[i + 1]![j + 1]! + 1) : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
    }
  }
  const ops: Array<{ t: "eq" | "del" | "add"; line: string }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      ops.push({ t: "eq", line: a[i]! });
      i++;
      j++;
    } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
      ops.push({ t: "del", line: a[i]! });
      i++;
    } else {
      ops.push({ t: "add", line: b[j]! });
      j++;
    }
  }
  while (i < n) {
    ops.push({ t: "del", line: a[i++]! });
  }
  while (j < m) {
    ops.push({ t: "add", line: b[j++]! });
  }
  return ops;
}

function splitLines(text: string): string[] {
  if (!text.length) return [];
  const lines = text.replace(/\n$/, "").split("\n");
  return lines;
}

export function diffStats(before: string, after: string): DiffStats {
  const a = splitLines(before);
  const b = splitLines(after);
  let added = 0;
  let removed = 0;
  for (const op of lineOps(a, b)) {
    if (op.t === "add") added++;
    else if (op.t === "del") removed++;
  }
  return { added, removed, summary: `+${added} −${removed}` };
}

/**
 * Unified diff text (no ANSI). Context lines around changes.
 */
export function formatUnifiedDiff(
  relPath: string,
  before: string,
  after: string,
  opts?: { context?: number; maxHunkLines?: number },
): string {
  const context = opts?.context ?? 3;
  const maxHunkLines = opts?.maxHunkLines ?? 220;
  const a = splitLines(before);
  const b = splitLines(after);
  const ops = lineOps(a, b);

  type Row = { t: "eq" | "del" | "add"; line: string; oa: number; ob: number };
  const rows: Row[] = [];
  let oa = 1;
  let ob = 1;
  for (const op of ops) {
    rows.push({ ...op, oa, ob });
    if (op.t === "eq") {
      oa++;
      ob++;
    } else if (op.t === "del") oa++;
    else ob++;
  }

  const changeIdx = rows
    .map((r, i) => (r.t !== "eq" ? i : -1))
    .filter((i) => i >= 0);
  if (changeIdx.length === 0) {
    return `--- a/${relPath}\n+++ b/${relPath}\n@@ (no textual change) @@`;
  }

  const include = new Set<number>();
  for (const i of changeIdx) {
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) {
      include.add(k);
    }
  }

  // Merge nearby islands
  const sorted = [...include].sort((x, y) => x - y);
  for (let idx = 0; idx < sorted.length - 1; idx++) {
    const cur = sorted[idx]!;
    const nxt = sorted[idx + 1]!;
    if (nxt - cur <= context * 2 + 1) {
      for (let k = cur; k <= nxt; k++) include.add(k);
    }
  }

  const hunks: string[] = [];
  let i = 0;
  let totalLines = 0;
  let truncated = false;
  while (i < rows.length) {
    if (!include.has(i)) {
      i++;
      continue;
    }
    let j = i;
    while (j + 1 < rows.length && include.has(j + 1)) j++;

    const slice = rows.slice(i, j + 1);
    const oldStart = slice[0]!.oa;
    const newStart = slice[0]!.ob;
    let oldCount = 0;
    let newCount = 0;
    const body: string[] = [];
    for (const r of slice) {
      if (r.t === "eq") {
        body.push(` ${r.line}`);
        oldCount++;
        newCount++;
      } else if (r.t === "del") {
        body.push(`-${r.line}`);
        oldCount++;
      } else {
        body.push(`+${r.line}`);
        newCount++;
      }
    }
    if (totalLines + body.length > maxHunkLines) {
      truncated = true;
      break;
    }
    hunks.push(
      `@@ -${oldStart},${oldCount} +${newStart},${newCount} @@\n${body.join("\n")}`,
    );
    totalLines += body.length;
    i = j + 1;
  }

  const header = `--- a/${relPath}\n+++ b/${relPath}`;
  const out = `${header}\n${hunks.join("\n")}`;
  return truncated
    ? `${out}\n…[diff truncated for display — file still written in full]`
    : out;
}

/** Print a reviewable colored diff to the terminal (Cursor-style). */
export function printReviewDiff(opts: {
  path: string;
  before: string;
  after: string;
  created: boolean;
}): DiffStats {
  const stats = diffStats(opts.before, opts.after);
  const title = opts.created
    ? `new file · ${opts.path} · ${stats.summary}`
    : `edit · ${opts.path} · ${stats.summary}`;
  console.log(`\n${style.bold(style.cyan("┌─ review"))} ${style.dim(title)}`);
  const raw = formatUnifiedDiff(opts.path, opts.before, opts.after);
  for (const line of raw.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) {
      console.log(style.dim(line));
    } else if (line.startsWith("+")) {
      console.log(style.green(line));
    } else if (line.startsWith("-")) {
      console.log(style.red(line));
    } else if (line.startsWith("@@")) {
      console.log(style.cyan(line));
    } else if (line.startsWith("…")) {
      console.log(style.yellow(line));
    } else {
      console.log(style.dim(line));
    }
  }
  console.log(style.cyan("└─"));
  return stats;
}
