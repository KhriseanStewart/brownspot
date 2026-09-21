import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type * as readline from "node:readline/promises";
import { MAX_STEPS, WORKSPACE } from "../config.ts";
import { compactMessages, truncateToolResult } from "./context.ts";
import { resolveLlm } from "./llm.ts";
import { MODEL_IDS } from "./model-prefs.ts";
import {
  addMemoriesFromMessages,
  formatHitsForPrompt,
  isMem0Enabled,
  loadFileMemory,
  searchMemories,
} from "./memory/index.ts";
import { firstLine, renderMarkdown, spinner, style } from "./style.ts";
import { runTool, tools } from "./tools.ts";
import { retrieveForTurn } from "./refs/retrieve.ts";
import { graphContextForTurn, isGraphifyEnabled } from "./graphify/index.ts";

export async function createInitialMessages(): Promise<ChatCompletionMessageParam[]> {
  const fileMemory = await loadFileMemory();

  return [
    {
      role: "system",
      content:
        `You are a helpful general-purpose assistant running in a CLI. ` +
        `Your workspace is ${WORKSPACE}. Answer normal questions directly. ` +
        `Only use file tools when the user asks you to inspect or change files. Be concise. For git/gh/ssh/docker/package ops prefer list_agent_commands then run_agent_command (catalog in Postgres; extensible). Use run_shell for one-off commands not in the catalog. Use list_reference_projects / search_reference_context for indexed reference and active project style context. Prefer graph_query / graph_path / graph_explain / graph_god_nodes / graph_affected over repeatedly read_file on the same paths — the Graphify graph is always kept up to date. ` +
        `Do not write AGENT_MEMORY.md unless the user explicitly asks — lasting preferences are stored by the memory system automatically.` +
        (fileMemory ? `\n\nPersistent file memory (AGENT_MEMORY.md):\n${fileMemory}` : ""),
    },
  ];
}

function lastUserText(messages: ChatCompletionMessageParam[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role === "user" && typeof m.content === "string") return m.content;
  }
  return "";
}

export async function runTurn(
  messages: ChatCompletionMessageParam[],
  rl: readline.Interface,
): Promise<void> {
  const userText = lastUserText(messages);
  const { client, model } = await resolveLlm(userText);

  console.log(style.dim(`(model: ${model})`));

  let memNoteIndex = -1;
  if (isMem0Enabled()) {
    const q = lastUserText(messages);
    const hits = await searchMemories(q);
    const block = formatHitsForPrompt(hits);
    if (block) {
      messages.push({
        role: "system",
        content: `Relevant memories for this user:\n${block}`,
      });
      memNoteIndex = messages.length - 1;
    }
  }

  let refsNoteIndex = -1;
  {
    const { note } = await retrieveForTurn(userText);
    if (note) {
      messages.push({ role: "system", content: note });
      refsNoteIndex = messages.length - 1;
    }
  }

  let graphNoteIndex = -1;
  if (isGraphifyEnabled()) {
    try {
      const gnote = graphContextForTurn(userText);
      if (gnote) {
        messages.push({ role: "system", content: gnote });
        graphNoteIndex = messages.length - 1;
      }
    } catch {
      /* never block the turn */
    }
  }

  let activeModel = model;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      await compactMessages(client, messages);

      // Cheap flash is fine for hello; after any tool use, stay on sonnet.
      const usedTools = messages.some(
        (m) =>
          m.role === "tool" ||
          (m.role === "assistant" &&
            Array.isArray((m as { tool_calls?: unknown }).tool_calls) &&
            ((m as { tool_calls?: unknown[] }).tool_calls?.length ?? 0) > 0),
      );
      if (usedTools && activeModel === MODEL_IDS.cheap) {
        activeModel = MODEL_IDS.sonnet;
        console.log(style.dim(`(model: ${activeModel} · escalated after tools)`));
      }

      const spin = spinner("thinking…");
      let res;
      try {
        res = await client.chat.completions.create({
          model: activeModel,
          messages,
          tools,
        });
      } catch (err) {
        spin.stop();
        const e = err as { status?: number; message?: string; error?: { message?: string } };
        const detail =
          e.error?.message || e.message || (err instanceof Error ? err.message : String(err));
        console.log(
          style.red(
            `LLM error${e.status ? ` ${e.status}` : ""}: ${detail}`,
          ),
        );
        console.log(
          style.dim(
            "Tip: /model sonnet  · check OpenRouter credits  · or retry the ask",
          ),
        );
        break;
      } finally {
        // spinner may already be stopped in catch
        try {
          spin.stop();
        } catch {
          /* ignore */
        }
      }
      const msg = res.choices[0]?.message;
      if (!msg) {
        console.log(style.red("No response from model."));
        break;
      }
      messages.push(msg);

      if (msg.content) {
        console.log(`\n${style.bold(style.brightMagenta("● agent"))}`);
        console.log(renderMarkdown(msg.content));
      }
      if (!msg.tool_calls?.length) break;

      for (const call of msg.tool_calls) {
        if (call.type !== "function") continue;
        const args = JSON.parse(call.function.arguments || "{}");
        const argStr = JSON.stringify(args).slice(0, 120);
        console.log(
          `\n${style.dim("→")} ${style.yellow(call.function.name)}${style.dim(`(${argStr})`)}`,
        );
        const result = truncateToolResult(await runTool(call.function.name, args, rl));
        console.log(style.dim(`  ↳ ${firstLine(result)}`));
        messages.push({ role: "tool", tool_call_id: call.id, content: result });
      }

      if (step === MAX_STEPS - 1) {
        console.log(style.red("\n(stopped: max steps reached)"));
      }
    }
  } finally {
    if (graphNoteIndex >= 0 && messages[graphNoteIndex]?.role === "system") {
      const c = messages[graphNoteIndex].content;
      if (typeof c === "string" && c.startsWith("Code knowledge graph")) {
        messages.splice(graphNoteIndex, 1);
        if (refsNoteIndex > graphNoteIndex) refsNoteIndex -= 1;
        if (memNoteIndex > graphNoteIndex) memNoteIndex -= 1;
      }
    }
    if (refsNoteIndex >= 0 && messages[refsNoteIndex]?.role === "system") {
      const c = messages[refsNoteIndex].content;
      if (typeof c === "string" && c.startsWith("Reference / active project context")) {
        messages.splice(refsNoteIndex, 1);
        if (memNoteIndex > refsNoteIndex) memNoteIndex -= 1;
      }
    }
    if (memNoteIndex >= 0 && messages[memNoteIndex]?.role === "system") {
      const c = messages[memNoteIndex].content;
      if (typeof c === "string" && c.startsWith("Relevant memories for this user:")) {
        messages.splice(memNoteIndex, 1);
      }
    }
  }

  if (isMem0Enabled()) {
    const forMem = messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => ({
        role: m.role as string,
        content: typeof m.content === "string" ? m.content : "",
      }))
      .filter((m) => m.content);
    // Fire-and-forget so the user never waits on Mem0 / local extract.
    void addMemoriesFromMessages(forMem);
  }
}
