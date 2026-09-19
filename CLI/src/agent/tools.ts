import type { ChatCompletionTool } from "openai/resources/chat/completions";
import * as fs from "node:fs/promises";
import path from "node:path";
import type * as readline from "node:readline/promises";
import { WORKSPACE } from "../config.ts";
import { runShellFiltered } from "./snip.ts";
import { style } from "./style.ts";

/** Keep every path inside the workspace. Does not resolve symlinks yet. */
export function resolveSafe(p: string): string {
  const abs = path.resolve(WORKSPACE, p);
  if (abs !== WORKSPACE && !abs.startsWith(WORKSPACE + path.sep)) {
    throw new Error(`Path escapes workspace: ${p}`);
  }
  return abs;
}

export const tools: ChatCompletionTool[] = [
  {
    type: "function",
    function: {
      name: "list_dir",
      description: "List files and folders in a directory (relative to workspace).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_file",
      description: "Read a UTF-8 text file.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "write_file",
      description: "Create or overwrite a file with the given content.",
      parameters: {
        type: "object",
        properties: { path: { type: "string" }, content: { type: "string" } },
        required: ["path", "content"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "delete_file",
      description: "Delete a file (moved to .agent-trash so it can be recovered).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "run_shell",
      description:
        "Run a shell command in the workspace. Output is filtered through snip when available to save tokens. Ask before destructive commands.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "Shell command to run (e.g. git status, bun test).",
          },
        },
        required: ["command"],
      },
    },
  },
];

async function approve(rl: readline.Interface, action: string): Promise<boolean> {
  const prompt = `\n${style.yellow("?")} ${style.bold("Allow:")} ${action} ${style.dim("[y/N]")} `;
  const answer = await rl.question(prompt);
  return answer.trim().toLowerCase() === "y";
}

function looksDangerous(command: string): boolean {
  return /\b(rm\s+-rf|sudo|mkfs|dd\s+if=|shutdown|reboot|curl\s+[^\n]*\|\s*(ba)?sh)\b/i.test(
    command,
  );
}

export async function runTool(
  name: string,
  args: Record<string, string>,
  rl: readline.Interface,
): Promise<string> {
  try {
    switch (name) {
      case "list_dir": {
        const entries = await fs.readdir(resolveSafe(args.path), { withFileTypes: true });
        return entries.map((e) => (e.isDirectory() ? `${e.name}/` : e.name)).join("\n") || "(empty)";
      }
      case "read_file":
        return await fs.readFile(resolveSafe(args.path), "utf8");
      case "write_file": {
        const abs = resolveSafe(args.path);
        if (!(await approve(rl, `write ${args.path} (${args.content.length} chars)`))) {
          return "User denied this action.";
        }
        await fs.mkdir(path.dirname(abs), { recursive: true });
        await fs.writeFile(abs, args.content, "utf8");
        return `Wrote ${args.path}`;
      }
      case "delete_file": {
        const abs = resolveSafe(args.path);
        if (!(await approve(rl, `DELETE ${args.path}`))) return "User denied this action.";
        const trash = path.join(WORKSPACE, ".agent-trash");
        await fs.mkdir(trash, { recursive: true });
        await fs.rename(abs, path.join(trash, `${Date.now()}-${path.basename(abs)}`));
        return `Moved ${args.path} to .agent-trash`;
      }
      case "run_shell": {
        const command = (args.command ?? "").trim();
        if (!command) return "Error: empty command";
        if (looksDangerous(command)) {
          if (!(await approve(rl, `run shell: ${command}`))) {
            return "User denied this action.";
          }
        }
        const result = runShellFiltered(command, { cwd: WORKSPACE });
        const parts = [
          result.usedSnip ? "[snip filtered]" : "[raw shell]",
          `exit ${result.status ?? "?"}`,
        ];
        const body = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
        return `${parts.join(" · ")}\n${body || "(no output)"}`;
      }
      default:
        return `Unknown tool: ${name}`;
    }
  } catch (err) {
    return `Error: ${err instanceof Error ? err.message : String(err)}`;
  }
}
