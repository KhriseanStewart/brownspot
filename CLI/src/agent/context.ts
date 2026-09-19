import type OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import {
  CONTEXT_KEEP_RECENT,
  CONTEXT_MAX_TOKENS,
  CONTEXT_SUMMARIZE,
  SUMMARY_MODEL,
  TOOL_RESULT_MAX_CHARS,
} from "../config.ts";
import { style } from "./style.ts";

/** Rough token estimate — good enough for budgeting without a tokenizer dep. */
export function estimateTokens(messages: ChatCompletionMessageParam[]): number {
  let chars = 0;
  for (const m of messages) {
    chars += JSON.stringify(m).length;
  }
  return Math.ceil(chars / 4);
}

export function truncateToolResult(content: string): string {
  if (content.length <= TOOL_RESULT_MAX_CHARS) return content;
  const keep = TOOL_RESULT_MAX_CHARS - 80;
  return `${content.slice(0, keep)}\n\n…[truncated ${content.length - keep} chars to save tokens]`;
}

function isToolMsg(m: ChatCompletionMessageParam | undefined): boolean {
  return !!m && m.role === "tool";
}

function isToolish(m: ChatCompletionMessageParam): boolean {
  if (m.role === "tool") return true;
  if (m.role === "assistant" && "tool_calls" in m && m.tool_calls?.length) return true;
  return false;
}

/**
 * Find a cut index so we keep the last `keepRecent` user messages (+ everything after
 * the first of those), without splitting an assistant tool_calls / tool result pair.
 */
function recentStartIndex(
  messages: ChatCompletionMessageParam[],
  keepRecent: number,
): number {
  let users = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "user") {
      users++;
      if (users >= keepRecent) {
        let start = i;
        // If the message before start is a tool result, walk back to the assistant that called it.
        while (start > 0 && messages[start].role === "tool") start--;
        if (start > 0 && isToolish(messages[start - 1]) && messages[start - 1].role === "assistant") {
          start--;
        }
        return start;
      }
    }
  }
  return 0;
}

function contentText(m: ChatCompletionMessageParam): string {
  if (!("content" in m) || m.content == null) return "";
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) {
    return m.content
      .map((part) => ("text" in part ? part.text : JSON.stringify(part)))
      .join("\n");
  }
  return String(m.content);
}

function formatForSummary(messages: ChatCompletionMessageParam[]): string {
  return messages
    .map((m) => {
      const role = m.role;
      const text = contentText(m).slice(0, 2000);
      if (m.role === "assistant" && "tool_calls" in m && m.tool_calls?.length) {
        const names = m.tool_calls
          .map((c) => (c.type === "function" ? c.function.name : c.type))
          .join(", ");
        return `${role}: [tool_calls: ${names}] ${text}`.trim();
      }
      return `${role}: ${text}`.trim();
    })
    .join("\n\n");
}

async function summarizeOlder(
  client: OpenAI,
  older: ChatCompletionMessageParam[],
): Promise<string> {
  const res = await client.chat.completions.create({
    model: SUMMARY_MODEL,
    messages: [
      {
        role: "system",
        content:
          "Summarize this earlier conversation for an AI agent. Preserve: user goals, decisions, " +
          "constraints, file paths touched, tool outcomes, and open todos. Drop chit-chat and " +
          "repeated tool payloads. Be dense and factual. Max ~400 words.",
      },
      { role: "user", content: formatForSummary(older) },
    ],
    temperature: 0,
  });
  return res.choices[0]?.message?.content?.trim() || "(no summary)";
}

/**
 * Compact `messages` in place when over the token budget.
 * Keeps system + recent user turns verbatim; older turns are summarized (or dropped).
 * Returns whether compaction happened.
 */
export async function compactMessages(
  client: OpenAI,
  messages: ChatCompletionMessageParam[],
): Promise<boolean> {
  if (estimateTokens(messages) <= CONTEXT_MAX_TOKENS) return false;

  const system = messages.filter((m) => m.role === "system");
  const rest = messages.filter((m) => m.role !== "system");
  if (rest.length === 0) return false;

  const start = recentStartIndex(rest, CONTEXT_KEEP_RECENT);
  const older = rest.slice(0, start);
  const recent = rest.slice(start);

  if (older.length === 0) {
    // Recent alone is too big — drop oldest non-system until under budget, keep tool pairs.
    while (estimateTokens([...system, ...recent]) > CONTEXT_MAX_TOKENS && recent.length > 2) {
      // drop from front, skip orphan tools
      if (isToolMsg(recent[0])) {
        recent.shift();
        continue;
      }
      recent.shift();
      while (isToolMsg(recent[0])) recent.shift();
    }
    messages.length = 0;
    messages.push(...system, ...recent);
    console.log(style.dim(`(context trimmed — ~${estimateTokens(messages)} tokens)`));
    return true;
  }

  let replacement: ChatCompletionMessageParam[];
  if (CONTEXT_SUMMARIZE) {
    try {
      const summary = await summarizeOlder(client, older);
      replacement = [
        {
          role: "system",
          content: `Earlier conversation summary (compacted to save tokens):\n${summary}`,
        },
      ];
      console.log(style.dim(`(context summarized ${older.length} older messages)`));
    } catch (err) {
      console.log(
        style.yellow(
          `(summary failed, dropping older turns: ${err instanceof Error ? err.message : String(err)})`,
        ),
      );
      replacement = [];
    }
  } else {
    replacement = [];
    console.log(style.dim(`(context dropped ${older.length} older messages)`));
  }

  messages.length = 0;
  messages.push(...system, ...replacement, ...recent);

  // If still over budget, drop more from the oldest recent side.
  while (estimateTokens(messages) > CONTEXT_MAX_TOKENS && messages.length > system.length + 2) {
    const i = system.length + (replacement.length ? 1 : 0);
    if (i >= messages.length - 1) break;
    messages.splice(i, 1);
    while (isToolMsg(messages[i])) messages.splice(i, 1);
  }

  console.log(style.dim(`(context now ~${estimateTokens(messages)} tokens)`));
  return true;
}
