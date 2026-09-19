import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const AGENT_HOME = path.join(
  process.env.AGENT_HOME ?? path.join(os.homedir(), ".agent-cli"),
);

export const CREDENTIALS_PATH = path.join(AGENT_HOME, "credentials.json");

export function ensureAuthDirs() {
  fs.mkdirSync(AGENT_HOME, { recursive: true });
}
