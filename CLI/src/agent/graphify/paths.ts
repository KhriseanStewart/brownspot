import path from "node:path";
import { AGENT_HOME } from "../memory/paths.ts";
import { WORKSPACE } from "../../config.ts";

export function graphifyOutDir(root = WORKSPACE): string {
  return path.join(root, "graphify-out");
}

export function graphJsonPath(root = WORKSPACE): string {
  return path.join(graphifyOutDir(root), "graph.json");
}

export function graphReportPath(root = WORKSPACE): string {
  return path.join(graphifyOutDir(root), "GRAPH_REPORT.md");
}

export function graphifyStateDir(): string {
  return path.join(AGENT_HOME, "graphify");
}

export function watchPidPath(root = WORKSPACE): string {
  const key = root.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(-120);
  return path.join(graphifyStateDir(), `watch-${key}.pid`);
}
