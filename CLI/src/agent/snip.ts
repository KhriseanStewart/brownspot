/**
 * Resolve and invoke edouard-claude/snip (CLI Token Killer).
 * Sidecar binary — never bake secrets; download via scripts/download-snip.mjs.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AGENT_HOME } from "./memory/paths.ts";

const WIN = process.platform === "win32";
const BIN_NAME = WIN ? "snip.exe" : "snip";

function platformKey(): string {
  const arch =
    process.arch === "x64" ? "x64" : process.arch === "arm64" ? "arm64" : process.arch;
  return `${process.platform}-${arch}`;
}

/** Candidate locations for the snip binary. */
export function snipCandidates(): string[] {
  const key = platformKey();
  const here = path.dirname(fileURLToPath(import.meta.url));
  const list: string[] = [];
  if (process.env.SNIP_BIN?.trim()) list.push(process.env.SNIP_BIN.trim());
  list.push(path.join(AGENT_HOME, "snip", "bin", BIN_NAME));
  // Dev / checkout
  list.push(path.join(here, "../../resources/snip", key, BIN_NAME));
  // Next to compiled binary
  try {
    const execDir = path.dirname(process.execPath);
    list.push(path.join(execDir, "snip", key, BIN_NAME));
    list.push(path.join(execDir, BIN_NAME));
  } catch {
    /* ignore */
  }
  list.push(path.join(os.homedir(), ".local", "bin", BIN_NAME));
  list.push(WIN ? "" : "/opt/homebrew/bin/snip");
  list.push(WIN ? "" : "/usr/local/bin/snip");
  return list.filter(Boolean);
}

export function resolveSnipBin(): string | null {
  for (const p of snipCandidates()) {
    try {
      if (p && fs.existsSync(p) && fs.statSync(p).isFile()) return p;
    } catch {
      /* continue */
    }
  }
  return null;
}

export function isSnipAvailable(): boolean {
  return resolveSnipBin() != null;
}

/** Ensure a copy lives under ~/.agent-cli/snip/bin for PATH-like use. */
export function ensureUserSnipBin(): string | null {
  const src = resolveSnipBin();
  if (!src) return null;
  const destDir = path.join(AGENT_HOME, "snip", "bin");
  const dest = path.join(destDir, BIN_NAME);
  try {
    fs.mkdirSync(destDir, { recursive: true });
    if (src !== dest) {
      fs.copyFileSync(src, dest);
      if (!WIN) fs.chmodSync(dest, 0o755);
    }
    return dest;
  } catch {
    return src;
  }
}

export type ShellRunResult = {
  stdout: string;
  stderr: string;
  status: number | null;
  usedSnip: boolean;
  command: string;
};

/**
 * Run a shell command, preferably through snip for token filtering.
 * Falls back to raw /bin/sh -c when snip is missing or SNIP_DISABLED=1.
 */
export function runShellFiltered(
  command: string,
  opts?: { cwd?: string; timeoutMs?: number; forceRaw?: boolean },
): ShellRunResult {
  const cwd = opts?.cwd ?? process.cwd();
  const timeout = opts?.timeoutMs ?? 120_000;
  const disabled =
    opts?.forceRaw ||
    ["1", "true", "yes"].includes((process.env.SNIP_DISABLED ?? "").toLowerCase());
  const snip = disabled ? null : ensureUserSnipBin() ?? resolveSnipBin();

  if (snip) {
    const r = spawnSync(snip, ["run", "--", "sh", "-c", command], {
      cwd,
      encoding: "utf8",
      timeout,
      env: process.env,
      maxBuffer: 8 * 1024 * 1024,
    });
    return {
      stdout: r.stdout ?? "",
      stderr: r.stderr ?? "",
      status: r.status,
      usedSnip: true,
      command,
    };
  }

  const r = spawnSync("sh", ["-c", command], {
    cwd,
    encoding: "utf8",
    timeout,
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  });
  return {
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    status: r.status,
    usedSnip: false,
    command,
  };
}

/** Token savings report from `snip gain`. */
export function snipGainReport(args: string[] = ["--weekly"]): string {
  const snip = resolveSnipBin();
  if (!snip) {
    return "snip is not installed. Run: bun run download-snip (or reinstall BrownSpot).";
  }
  const r = spawnSync(snip, ["gain", ...args], {
    encoding: "utf8",
    timeout: 30_000,
    env: process.env,
  });
  const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();
  if (r.status !== 0 && !out) {
    return `snip gain failed (exit ${r.status})`;
  }
  return out || "(no snip savings data yet — run some shell tools first)";
}

export function snipVersion(): string | null {
  const snip = resolveSnipBin();
  if (!snip) return null;
  const r = spawnSync(snip, ["--version"], { encoding: "utf8", timeout: 5_000 });
  return (r.stdout || r.stderr || "").trim() || null;
}
