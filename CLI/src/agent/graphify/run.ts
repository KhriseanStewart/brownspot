import { execFileSync, spawn } from "node:child_process";
import { resolveGraphifyBin } from "./bin.ts";

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
        PATH: `${bin.includes("/") ? bin.slice(0, bin.lastIndexOf("/")) : ""}:${process.env.PATH ?? ""}`,
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

/** Spawn detached background process; returns PID. */
export function spawnGraphifyDetached(
  args: string[],
  opts?: { cwd?: string },
): number | null {
  const bin = resolveGraphifyBin();
  if (!bin) return null;
  const child = spawn(bin, args, {
    cwd: opts?.cwd,
    detached: true,
    stdio: "ignore",
    env: process.env,
  });
  child.unref();
  return child.pid ?? null;
}
