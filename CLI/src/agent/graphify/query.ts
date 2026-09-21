import { GRAPHIFY_QUERY_BUDGET, WORKSPACE } from "../../config.ts";
import { graphJsonPath } from "./paths.ts";
import { runGraphify } from "./run.ts";
import { ensureGraph, isGraphifyEnabled } from "./ensure.ts";
import fs from "node:fs";

function graphArg(root = WORKSPACE): string[] {
  return ["--graph", graphJsonPath(root)];
}

function needGraph(root = WORKSPACE): string | null {
  if (!isGraphifyEnabled()) return "graphify disabled";
  if (!fs.existsSync(graphJsonPath(root))) {
    const r = ensureGraph(root);
    if (!r.ok) return r.message;
  }
  return null;
}

export function graphQuery(question: string, opts?: { budget?: number; dfs?: boolean }): string {
  const err = needGraph();
  if (err) return err;
  const budget = opts?.budget ?? GRAPHIFY_QUERY_BUDGET;
  const args = [
    "query",
    question,
    "--budget",
    String(budget),
    ...graphArg(),
    ...(opts?.dfs ? ["--dfs"] : []),
  ];
  const r = runGraphify(args);
  return (r.stdout || r.stderr || "(empty)").trim();
}

export function graphPath(a: string, b: string): string {
  const err = needGraph();
  if (err) return err;
  const r = runGraphify(["path", a, b, ...graphArg()]);
  return (r.stdout || r.stderr || "(empty)").trim();
}

export function graphExplain(node: string): string {
  const err = needGraph();
  if (err) return err;
  const r = runGraphify(["explain", node, ...graphArg()]);
  return (r.stdout || r.stderr || "(empty)").trim();
}

export function graphGodNodes(top = 10): string {
  const err = needGraph();
  if (err) return err;
  const r = runGraphify(["god-nodes", "--top", String(top), ...graphArg()]);
  return (r.stdout || r.stderr || "(empty)").trim();
}

export function graphAffected(node: string, depth = 2): string {
  const err = needGraph();
  if (err) return err;
  const r = runGraphify([
    "affected",
    node,
    "--depth",
    String(depth),
    ...graphArg(),
  ]);
  return (r.stdout || r.stderr || "(empty)").trim();
}

export function graphBenchmark(): string {
  const err = needGraph();
  if (err) return err;
  const r = runGraphify(["benchmark", graphJsonPath()]);
  return (r.stdout || r.stderr || "(empty)").trim();
}

export function graphReportSnippet(maxChars = 2500): string {
  const report = `${WORKSPACE}/graphify-out/GRAPH_REPORT.md`;
  if (!fs.existsSync(report)) return "";
  try {
    const text = fs.readFileSync(report, "utf8");
    return text.length > maxChars ? text.slice(0, maxChars) + "\n…" : text;
  } catch {
    return "";
  }
}

/** Cheap auto-context for a coding turn — query the graph, not the files. */
export function graphContextForTurn(userText: string): string {
  if (!isGraphifyEnabled() || !userText.trim()) return "";
  if (!fs.existsSync(graphJsonPath())) {
    ensureGraph();
  }
  if (!fs.existsSync(graphJsonPath())) return "";

  const q = userText.trim().slice(0, 240);
  const parts: string[] = [];
  const queryOut = graphQuery(q, { budget: GRAPHIFY_QUERY_BUDGET });
  if (queryOut && !queryOut.startsWith("graphify")) {
    parts.push("### Graphify query (prefer this over re-reading files)\n" + queryOut);
  }
  const gods = graphGodNodes(8);
  if (gods.includes("God nodes") || gods.includes("edges")) {
    parts.push("### God nodes\n" + gods);
  }
  const report = graphReportSnippet(1200);
  if (report) parts.push("### GRAPH_REPORT.md (excerpt)\n" + report);
  if (!parts.length) return "";
  return (
    "Code knowledge graph for this workspace (Graphify). " +
    "Use these facts instead of repeatedly calling read_file on the same paths. " +
    "For deeper structure use graph_query / graph_path / graph_explain / graph_affected.\n\n" +
    parts.join("\n\n")
  );
}
