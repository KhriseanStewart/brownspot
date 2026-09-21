import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { resolveGraphifyBin } from "./bin.ts";
import { graphifyStateDir } from "./paths.ts";

export type RunResult = { ok: boolean; stdout: string; stderr: string; status: number | null };

export function runGraphify(
  args: string[],
  opts?: { cwd?: string; timeoutMs?: number },
): RunResult {
  const bin = resolveGraphifyBin();
  if (!bin) {
    return {
      ok: false,
      stdout: "",
      stderr:
        "graphify not found. Install: curl -LsSf https://astral.sh/uv/install.sh | sh && uv tool install graphifyy",
      status: 127,
    };
  }
  try {
    const stdout = execFileSync(bin, args, {
      encoding: "utf8",
      cwd: opts?.cwd,
      timeout: opts?.timeoutMs ?? 180_000,
      maxBuffer: 8_000_000,
      env: {
        ...process.env,
        PATH: `${path.dirname(bin)}:${process.env.PATH ?? ""}`,
      },
    });
    return { ok: true, stdout: stdout ?? "", stderr: "", status: 0 };
  } catch (e) {
    const err = e as {
      status?: number;
      stdout?: string | Buffer;
      stderr?: string | Buffer;
      message?: string;
    };
    return {
      ok: false,
      stdout: String(err.stdout ?? ""),
      stderr: String(err.stderr ?? err.message ?? e),
      status: typeof err.status === "number" ? err.status : 1,
    };
  }
}

export function watchLogPath(): string {
  return path.join(graphifyStateDir(), "watch.log");
}

/**
 * Spawn detached graphify with stdout/stderr logged.
 * Returns PID, or null on failure.
 */
export function spawnGraphifyDetached(
  args: string[],
  opts?: { cwd?: string },
): number | null {
  const bin = resolveGraphifyBin();
  if (!bin) return null;
  fs.mkdirSync(graphifyStateDir(), { recursive: true });
  const logFile = watchLogPath();
  const out = fs.openSync(logFile, "a");
  fs.writeSync(out, `\n--- ${new Date().toISOString()} graphify ${args.join(" ")} ---\n`);
  const child = spawn(bin, args, {
    cwd: opts?.cwd,
    detached: true,
    stdio: ["ignore", out, out],
    env: {
      ...process.env,
      PATH: `${path.dirname(bin)}:${process.env.PATH ?? ""}`,
    },
  });
  child.unref();
  return child.pid ?? null;
}
