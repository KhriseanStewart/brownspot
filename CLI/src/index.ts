#!/usr/bin/env bun
import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import {
  AGENT_AGENT_ID,
  AGENT_ROLE,
  getAgentUserId,
  MODEL,
  WORKSPACE,
  requireConfig,
} from "./config.ts";
import {
  createInitialMessages,
  ensureAgentDirs,
  ensureReady,
  handleMemoryCommand,
  isMem0Enabled,
  memoryBackend,
  runTurn,
} from "./agent/index.ts";
import { printBanner, style } from "./agent/style.ts";
import { ensureLoggedInForChat, getValidSession } from "./auth/session.ts";
import { clearSession } from "./auth/credentials.ts";
import { cmdLogin } from "./cli/commands/login.ts";
import { cmdLogout } from "./cli/commands/logout.ts";
import { cmdWhoami, printWhoami } from "./cli/commands/whoami.ts";

const args = process.argv.slice(2);
const cmd = args[0];

async function main() {
  if (cmd === "login") {
    await cmdLogin();
    return;
  }
  if (cmd === "logout") {
    await cmdLogout();
    return;
  }
  if (cmd === "whoami") {
    await cmdWhoami();
    return;
  }

  requireConfig();
  ensureAgentDirs();

  // Always: login if needed, then chat
  const session = await ensureLoggedInForChat();
  if (!process.env.AGENT_USER_ID) {
    process.env.AGENT_USER_ID = session.userId;
  }
  console.log(style.dim(`auth · ${session.email ?? session.userId}`));

  if (isMem0Enabled()) ensureReady();

  const rl = readline.createInterface({ input, output });
  const messages = await createInitialMessages();

  printBanner(WORKSPACE, MODEL!);
  if (isMem0Enabled()) {
    console.log(
      style.dim(
        `memory on · ${memoryBackend()} · user ${getAgentUserId()}${AGENT_AGENT_ID ? ` · agent ${AGENT_AGENT_ID}` : ` · role ${AGENT_ROLE}`} · /memory help · /whoami\n`,
      ),
    );
  } else {
    console.log(
      style.dim(
        `memory off · set MEM0_API_KEY or AGENT_MEM0=true · /memory help · /whoami\n`,
      ),
    );
  }

  while (true) {
    const line = (
      await rl.question(`${style.bold(style.cyan("you"))} ${style.dim("›")} `)
    ).trim();
    if (!line) continue;
    if (line === "exit" || line === "/exit" || line === "quit") break;

    if (line === "/whoami" || line === "whoami") {
      const s = await getValidSession();
      if (!s) {
        console.log(style.yellow("Session expired. Run /login or restart with bun run dev."));
      } else {
        printWhoami(s);
      }
      continue;
    }
    if (line === "/logout" || line === "logout") {
      clearSession();
      console.log(style.yellow("Logged out. Restart with bun run dev to sign in again."));
      break;
    }
    if (line === "/login" || line === "login") {
      await cmdLogin();
      continue;
    }
    if (await handleMemoryCommand(line)) continue;

    messages.push({ role: "user", content: line });
    await runTurn(messages, rl);
  }
  rl.close();
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
