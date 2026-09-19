import os from "node:os";
import path from "node:path";
import fs from "node:fs";

/** Persistent home for agent-cli data (memories, indexes). */
export const AGENT_HOME = path.join(
  process.env.AGENT_HOME ?? path.join(os.homedir(), ".agent-cli"),
);

export const MEM0_DIR = path.join(AGENT_HOME, "mem0");
export const INDEXES_DIR = path.join(AGENT_HOME, "indexes");

export function ensureAgentDirs(): void {
  fs.mkdirSync(MEM0_DIR, { recursive: true });
  fs.mkdirSync(INDEXES_DIR, { recursive: true });
}

export function mem0VectorDbPath(): string {
  return path.join(MEM0_DIR, "vectors.db");
}

export function mem0HistoryDbPath(): string {
  return path.join(MEM0_DIR, "history.db");
}
