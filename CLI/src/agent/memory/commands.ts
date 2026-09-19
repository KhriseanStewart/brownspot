import { AGENT_AGENT_ID, AGENT_ROLE, getAgentUserId } from "../../config.ts";
import { style } from "../style.ts";
import {
  ensureReady,
  isMem0Enabled,
  memoryBackend,
  searchMemories,
  setMem0Enabled,
} from "./mem0.ts";

/** Handle /memory … commands. Returns true if consumed. */
export async function handleMemoryCommand(line: string): Promise<boolean> {
  if (!line.startsWith("/memory")) return false;

  const rest = line.slice("/memory".length).trim();
  const [cmd, ...args] = rest ? rest.split(/\s+/) : ["help"];
  const arg = args.join(" ").trim();
  const userId = getAgentUserId();

  switch (cmd.toLowerCase()) {
    case "on":
      setMem0Enabled(true);
      {
        const backend = ensureReady();
        console.log(
          style.green(
            `Personal memory on (user: ${userId}` +
              `${AGENT_AGENT_ID ? `, agent: ${AGENT_AGENT_ID}` : ""}` +
              `, role: ${AGENT_ROLE}, backend: ${backend})`,
          ),
        );
      }
      return true;
    case "off":
      setMem0Enabled(false);
      console.log(style.yellow("Personal memory off for this session"));
      return true;
    case "status": {
      if (!isMem0Enabled()) {
        console.log(
          style.dim(
            "Memory disabled · set MEM0_API_KEY (Mem0 free) or AGENT_MEM0=true, or /memory on",
          ),
        );
        return true;
      }
      const backend = memoryBackend();
      const where =
        backend === "platform"
          ? "Mem0 Platform (api.mem0.ai)"
          : "local ~/.agent-cli/mem0";
      console.log(
        style.green(
          `Memory enabled · user ${userId}` +
            `${AGENT_AGENT_ID ? ` · agent ${AGENT_AGENT_ID}` : ""}` +
            ` · role ${AGENT_ROLE} · ${where}`,
        ),
      );
      return true;
    }
    case "search": {
      if (!isMem0Enabled()) {
        console.log(style.yellow("Memory is off. Use /memory on first."));
        return true;
      }
      if (!arg) {
        console.log(style.dim("Usage: /memory search <query>"));
        return true;
      }
      const hits = await searchMemories(arg);
      if (!hits.length) {
        console.log(style.dim("(no memories found)"));
        return true;
      }
      for (const h of hits) {
        const score = h.score != null ? style.dim(` (${h.score.toFixed(3)})`) : "";
        console.log(`• ${h.memory}${score}`);
      }
      return true;
    }
    case "help":
    default:
      console.log(`Memory commands:
  /memory on              Enable personal memory this session
  /memory off             Disable for this session
  /memory status          Show user / agent / role / backend
  /memory search <query>  Search stored memories

Scope different people/roles with env:
  AGENT_USER_ID=alex
  AGENT_AGENT_ID=developer
  AGENT_ROLE=developer
`);
      return true;
  }
}
