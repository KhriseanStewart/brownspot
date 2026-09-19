import path from "node:path";
import { WORKSPACE } from "../../config.ts";

/** Legacy markdown notes in the workspace (still loaded as a fallback). */
export async function loadFileMemory(): Promise<string> {
  try {
    return await Bun.file(path.join(WORKSPACE, "AGENT_MEMORY.md")).text();
  } catch {
    return "";
  }
}
