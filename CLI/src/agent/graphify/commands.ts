import { WORKSPACE } from "../../config.ts";
import { style } from "../style.ts";
import {
  ensureGraph,
  ensureWatch,
  graphifyStatus,
  isGraphifyEnabled,
  stopWatch,
} from "./ensure.ts";
import {
  graphAffected,
  graphBenchmark,
  graphExplain,
  graphGodNodes,
  graphPath,
  graphQuery,
} from "./query.ts";
import { resolveGraphifyBin } from "./bin.ts";
import { runGraphify } from "./run.ts";

function help(): string {
  return `Graphify (always-on code knowledge graph)
  /graphify              status
  /graphify update       rebuild AST graph (no LLM)
  /graphify watch        start background watch
  /graphify stop         stop watch
  /graphify query <q>    BFS query
  /graphify path A | B   shortest path (use | between nodes)
  /graphify explain <n>  explain a node
  /graphify gods         most connected nodes
  /graphify affected <n> reverse impact
  /graphify benchmark    token savings vs full corpus
  /graphify extract      full extract --code-only

Saves OpenRouter tokens: ask the graph before re-reading files.
`;
}

export function handleGraphifyCommand(line: string): boolean {
  if (!line.startsWith("/graphify") && !line.startsWith("/graph")) return false;
  const rest = line.replace(/^\/graphify\b|^\/graph\b/, "").trim();
  const [cmd, ...args] = rest ? rest.split(/\s+/) : ["status"];
  const arg = args.join(" ").trim();

  if (!isGraphifyEnabled()) {
    console.log(style.yellow("Graphify disabled. Set BROWNSPOT_GRAPHIFY=true"));
    return true;
  }
  if (!resolveGraphifyBin() && cmd !== "help" && cmd !== "status") {
    console.log(
      style.yellow(
        "Install graphify: uv tool install graphifyy  (needs uv: https://astral.sh/uv)",
      ),
    );
    return true;
  }

  switch (cmd.toLowerCase()) {
    case "help":
      console.log(help());
      return true;
    case "status":
    case "":
      console.log(graphifyStatus(WORKSPACE));
      return true;
    case "update":
    case "rebuild": {
      console.log(style.dim("graphify · updating…"));
      const r = ensureGraph(WORKSPACE);
      console.log(r.ok ? style.green(r.message.slice(0, 300)) : style.red(r.message));
      return true;
    }
    case "watch": {
      const r = ensureWatch(WORKSPACE);
      console.log(r.ok ? style.green(r.message) : style.yellow(r.message));
      return true;
    }
    case "stop":
      stopWatch(WORKSPACE);
      console.log(style.dim("graphify · watch stopped"));
      return true;
    case "query":
      if (!arg) {
        console.log(style.dim("Usage: /graphify query <question>"));
        return true;
      }
      console.log(graphQuery(arg));
      return true;
    case "path": {
      const parts = arg.split("|").map((s) => s.trim()).filter(Boolean);
      if (parts.length < 2) {
        console.log(style.dim('Usage: /graphify path AuthScreen | MainShell'));
        return true;
      }
      console.log(graphPath(parts[0]!, parts[1]!));
      return true;
    }
    case "explain":
      if (!arg) {
        console.log(style.dim("Usage: /graphify explain <node>"));
        return true;
      }
      console.log(graphExplain(arg));
      return true;
    case "gods":
    case "god-nodes":
      console.log(graphGodNodes());
      return true;
    case "affected":
      if (!arg) {
        console.log(style.dim("Usage: /graphify affected <node>"));
        return true;
      }
      console.log(graphAffected(arg));
      return true;
    case "benchmark":
      console.log(graphBenchmark());
      return true;
    case "extract": {
      const r = runGraphify(
        ["extract", WORKSPACE, "--code-only", "--no-cluster", "--out", WORKSPACE],
        { cwd: WORKSPACE, timeoutMs: 300_000 },
      );
      console.log((r.stdout || r.stderr).slice(0, 2000));
      return true;
    }
    default:
      console.log(style.dim(`Unknown: ${cmd}`));
      console.log(help());
      return true;
  }
}
