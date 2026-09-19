import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import type * as readline from "node:readline/promises";
import { MAX_STEPS, WORKSPACE } from "../config.ts";
import { compactMessages, truncateToolResult } from "./context.ts";
import { resolveLlm } from "./llm.ts";
import {
  addMemoriesFromMessages,
  formatHitsForPrompt,
  isMem0Enabled,
  loadFileMemory,
  searchMemories,
} from "./memory/index.ts";
import { firstLine, renderMarkdown, spinner, style } from "./style.ts";
import { runTool, tools } from "./tools.ts";

export async function createInitialMessages(): Promise<ChatCompletionMessageParam[]> {
  const fileMemory = await loadFileMemory();

  return [
    {
      role: "system",
      content:
        `You are a helpful general-purpose assistant running in a CLI. ` +
        `Your workspace is ${WORKSPACE}. Answer normal questions directly. ` +
        `Only use file tools when the user asks you to inspect or change files. Be concise. ` +
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
  const { client, model } = await resolveLlm();

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
      console.log(style.dim(`(memory: ${hits.length} memories)`));
    }
  }

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      await compactMessages(client, messages);

      const spin = spinner("thinking…");
      let res;
      try {
        res = await client.chat.completions.create({
          model,
          messages,
          tools,
        });
      } finally {
        spin.stop();
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
    await addMemoriesFromMessages(forMem);
  }
}
