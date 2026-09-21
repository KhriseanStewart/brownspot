import fs from "node:fs";
import path from "node:path";
import {
  GRAPHIFY_CODE_ONLY,
  GRAPHIFY_ENABLED,
  GRAPHIFY_WATCH,
  WORKSPACE,
} from "../../config.ts";
import { ensureAgentDirs } from "../memory/paths.ts";
import { style } from "../style.ts";
import { resolveGraphifyBin, graphifyVersion } from "./bin.ts";
import {
  graphJsonPath,
  graphifyOutDir,
  graphifyStateDir,
  watchPidPath,
} from "./paths.ts";
import { runGraphify, spawnGraphifyDetached, watchLogPath } from "./run.ts";

export function isGraphifyEnabled(): boolean {
  return GRAPHIFY_ENABLED;
}

export function graphifyStatus(root = WORKSPACE): string {
  const bin = resolveGraphifyBin();
  const graph = graphJsonPath(root);
  const hasGraph = fs.existsSync(graph);
  let nodes = "?";
  if (hasGraph) {
    try {
      const raw = JSON.parse(fs.readFileSync(graph, "utf8")) as {
        nodes?: unknown[];
        graph?: { nodes?: unknown[] };
      };
      const n = raw.nodes?.length ?? raw.graph?.nodes?.length;
      if (typeof n === "number") nodes = String(n);
    } catch {
      /* ignore */
    }
  }
  const watching = isWatchRunning(root);
  return [
    `graphify · ${bin ? graphifyVersion() ?? "ready" : "NOT INSTALLED"}`,
    `graph · ${hasGraph ? graph : "missing"} (${nodes} nodes)`,
    `watch · ${watching ? "running" : "stopped — run /graphify watch"}`,
    `code-only · ${GRAPHIFY_CODE_ONLY ? "yes" : "no"}`,
  ].join("\n");
}

export function isWatchRunning(root = WORKSPACE): boolean {
  const pidFile = watchPidPath(root);
  if (!fs.existsSync(pidFile)) return false;
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    try {
      fs.unlinkSync(pidFile);
    } catch {
      /* ignore */
    }
    return false;
  }
}

/** Build or refresh code graph (AST only by default — no OpenRouter). */
export function ensureGraph(root = WORKSPACE): {
  ok: boolean;
  message: string;
} {
  if (!GRAPHIFY_ENABLED) {
    return { ok: false, message: "graphify disabled (BROWNSPOT_GRAPHIFY=false)" };
  }
  if (!resolveGraphifyBin()) {
    return {
      ok: false,
      message:
        "graphify CLI missing — install: uv tool install graphifyy  (or curl -LsSf https://astral.sh/uv/install.sh | sh)",
    };
  }

  ensureAgentDirs();
  fs.mkdirSync(graphifyStateDir(), { recursive: true });
  fs.mkdirSync(graphifyOutDir(root), { recursive: true });

  const hasGraph = fs.existsSync(graphJsonPath(root));
  const args = hasGraph
    ? (["update", root, "--no-cluster"] as string[])
    : ([
        "extract",
        root,
        ...(GRAPHIFY_CODE_ONLY ? ["--code-only"] : []),
        "--no-cluster",
        "--out",
        root,
      ] as string[]);

  const result = runGraphify(args, { cwd: root, timeoutMs: 300_000 });
  const out = (result.stdout + "\n" + result.stderr).trim();
  if (!result.ok && !fs.existsSync(graphJsonPath(root))) {
    return { ok: false, message: out.slice(0, 800) || "graphify extract failed" };
  }
  return {
    ok: true,
    message: out.split("\n").slice(-4).join(" · ") || "graph ready",
  };
}

/** Start background watch if not already running. Verifies it stays alive. */
export function ensureWatch(root = WORKSPACE): { ok: boolean; message: string } {
  if (!GRAPHIFY_ENABLED || !GRAPHIFY_WATCH) {
    return { ok: false, message: "watch disabled" };
  }
  if (!resolveGraphifyBin()) {
    return { ok: false, message: "graphify not installed" };
  }
  if (isWatchRunning(root)) {
    return { ok: true, message: "watch already running" };
  }
  const pid = spawnGraphifyDetached(["watch", root], { cwd: root });
  if (!pid) return { ok: false, message: "failed to spawn watch" };
  fs.mkdirSync(path.dirname(watchPidPath(root)), { recursive: true });
  fs.writeFileSync(watchPidPath(root), String(pid), "utf8");

  // graphify exits immediately if watchdog is missing — detect that
  Bun.sleepSync(1200);
  try {
    process.kill(pid, 0);
    return { ok: true, message: `watch started · pid ${pid}` };
  } catch {
    try {
      fs.unlinkSync(watchPidPath(root));
    } catch {
      /* ignore */
    }
    let tip = "";
    try {
      const log = fs.readFileSync(watchLogPath(), "utf8");
      const tail = log.trim().split("\n").slice(-6).join(" ");
      tip = tail ? ` · ${tail.slice(0, 180)}` : "";
      if (/watchdog/i.test(log)) {
        tip += ' · fix: uv tool install \'graphifyy[watch]\'';
      }
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      message: `watch exited right away (pid ${pid})${tip}`,
    };
  }
}

export function stopWatch(root = WORKSPACE): void {
  const pidFile = watchPidPath(root);
  if (!fs.existsSync(pidFile)) return;
  const pid = Number(fs.readFileSync(pidFile, "utf8").trim());
  try {
    if (Number.isFinite(pid) && pid > 0) process.kill(pid, "SIGTERM");
  } catch {
    /* already gone */
  }
  try {
    fs.unlinkSync(pidFile);
  } catch {
    /* ignore */
  }
}

/** Startup: ensure graph + watch. Never throws. */
export async function runGraphifyStartup(): Promise<void> {
  if (!GRAPHIFY_ENABLED) {
    console.log(style.dim("graphify · off (BROWNSPOT_GRAPHIFY=false)"));
    return;
  }
  if (!resolveGraphifyBin()) {
    console.log(
      style.dim(
        "graphify · not installed · uv tool install graphifyy  (then restart)",
      ),
    );
    return;
  }
  console.log(style.dim(`graphify · ${graphifyVersion() ?? "ready"} · indexing ${WORKSPACE}…`));
  const built = ensureGraph(WORKSPACE);
  if (built.ok) {
    // Prefer a short status line over raw CLI noise (paths get truncated otherwise)
    const lines = built.message
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const useful =
      lines.find((l) => /\d+\s+nodes/i.test(l)) ||
      lines.filter((l) => !l.includes("warning:")).slice(-1)[0] ||
      "graph ready";
    for (const wline of lines.filter((l) => /warning:/i.test(l)).slice(0, 2)) {
      console.log(style.dim(`  ${wline.slice(0, 200)}`));
    }
    console.log(style.dim(`graphify · ${useful.slice(0, 180)}`));
    console.log(style.dim(graphifyStatus(WORKSPACE).split("\n").slice(0, 3).join(" · ")));
  } else {
    console.log(style.yellow(`graphify · ${built.message.slice(0, 200)}`));
  }
  const w = ensureWatch(WORKSPACE);
  if (w.ok) console.log(style.dim(`graphify · ${w.message}`));
}
