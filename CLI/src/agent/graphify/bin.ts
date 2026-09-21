import { existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const CANDIDATES = [
  process.env.GRAPHIFY_BIN,
  path.join(homedir(), ".local/bin/graphify"),
  "/opt/homebrew/bin/graphify",
  "/usr/local/bin/graphify",
].filter(Boolean) as string[];

let cached: string | null | undefined;

/** Resolve graphify executable, or null if missing. */
export function resolveGraphifyBin(): string | null {
  if (cached !== undefined) return cached;
  for (const c of CANDIDATES) {
    if (c && existsSync(c)) {
      cached = c;
      return cached;
    }
  }
  try {
    const which = execFileSync("which", ["graphify"], {
      encoding: "utf8",
      env: process.env,
    }).trim();
    if (which && existsSync(which)) {
      cached = which;
      return cached;
    }
  } catch {
    /* not on PATH */
  }
  cached = null;
  return null;
}

export function graphifyVersion(): string | null {
  const bin = resolveGraphifyBin();
  if (!bin) return null;
  try {
    // graphify has no --version; probe help header
    const out = execFileSync(bin, ["--help"], {
      encoding: "utf8",
      env: { ...process.env, PATH: `${path.dirname(bin)}:${process.env.PATH ?? ""}` },
      maxBuffer: 256_000,
    });
    const m = out.match(/graphifyy[^\n]*/i);
    return m?.[0] ?? "graphify";
  } catch {
    return "graphify";
  }
}

export function clearGraphifyBinCache(): void {
  cached = undefined;
}
