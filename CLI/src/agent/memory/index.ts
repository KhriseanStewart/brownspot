export { loadFileMemory } from "./file-memory.ts";
export { handleMemoryCommand } from "./commands.ts";
export {
  addMemoriesFromMessages,
  ensureReady,
  formatHitsForPrompt,
  getMem0Client,
  isMem0Enabled,
  memoryBackend,
  searchMemories,
  setMem0Enabled,
} from "./mem0.ts";
export { AGENT_HOME, INDEXES_DIR, MEM0_DIR, ensureAgentDirs } from "./paths.ts";
