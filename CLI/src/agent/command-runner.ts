import type * as readline from "node:readline/promises";
import {
  getAgentCommand,
  listAgentCommands,
  listCommandCategories,
  recordCommandRun,
} from "../db/commands.ts";
import { WORKSPACE, getAgentUserId } from "../config.ts";
import { COMMAND_DEFAULTS, interpolateTemplate } from "./command-interpolate.ts";
import { runShellFiltered } from "./snip.ts";
import { style } from "./style.ts";

async function approve(rl: readline.Interface, action: string): Promise<boolean> {
  const prompt = `\n${style.yellow("?")} ${style.bold("Allow:")} ${action} ${style.dim("[y/N]")} `;
  const answer = await rl.question(prompt);
  return answer.trim().toLowerCase() === "y";
}

export async function formatCommandCatalog(opts?: {
  category?: string;
  q?: string;
}): Promise<string> {
  try {
    const cats = await listCommandCategories();
    const rows = await listAgentCommands(opts);
    if (!rows.length) {
      return "No commands found. Run: bun run db:seed-commands";
    }
    const lines = [
      `Agent command catalog (${rows.length} shown). Categories: ${cats.join(", ")}`,
      `Use run_agent_command with slug + params JSON. High/critical always ask for approval.`,
      "",
    ];
    let lastCat = "";
    for (const c of rows) {
      if (c.category !== lastCat) {
        lastCat = c.category;
        lines.push(`## ${c.category}`);
      }
      const params = c.params_schema?.params ?? [];
      const paramHint = params.length
        ? ` params: ${params.map((p) => (p.required ? p.name : `${p.name}?`)).join(", ")}`
        : "";
      lines.push(
        `- ${c.slug} [${c.risk_level}] ${c.name} — ${c.description}${paramHint}`,
      );
    }
    return lines.join("\n");
  } catch (e) {
    return `Command catalog unavailable (DB?): ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function runCatalogCommand(
  slug: string,
  paramsJson: string,
  rl: readline.Interface,
): Promise<string> {
  let params: Record<string, string> = {};
  if (paramsJson?.trim()) {
    try {
      const parsed = JSON.parse(paramsJson) as Record<string, unknown>;
      for (const [k, v] of Object.entries(parsed)) {
        params[k] = v == null ? "" : String(v);
      }
    } catch {
      return "Error: params must be a JSON object string, e.g. {\"message\":\"fix\"}";
    }
  }

  let cmd;
  try {
    cmd = await getAgentCommand(slug);
  } catch (e) {
    return `Error loading command from DB: ${e instanceof Error ? e.message : String(e)}`;
  }
  if (!cmd) return `Unknown or disabled command slug: ${slug}. Use list_agent_commands.`;

  const schemaParams = cmd.params_schema?.params ?? [];
  for (const p of schemaParams) {
    if (p.required && !(params[p.name] ?? "").trim()) {
      return `Missing required param: ${p.name}${p.description ? ` (${p.description})` : ""}`;
    }
  }

  if (cmd.handler_type !== "shell_template" || !cmd.template) {
    return `Handler ${cmd.handler_type} not implemented yet for ${slug}`;
  }

  const defaults = COMMAND_DEFAULTS[slug] ?? {};
  const resolved = interpolateTemplate(cmd.template, params, defaults);

  const needApproval =
    cmd.requires_approval ||
    cmd.risk_level === "high" ||
    cmd.risk_level === "critical";
  if (needApproval) {
    const ok = await approve(
      rl,
      `[${cmd.risk_level}] ${cmd.slug}: ${resolved}`,
    );
    if (!ok) return "User denied this command.";
  }

  const result = runShellFiltered(resolved, { cwd: WORKSPACE });
  const success = result.status === 0;
  try {
    await recordCommandRun({
      slug: cmd.slug,
      clerkUserId: getAgentUserId(),
      params,
      resolvedCmd: resolved,
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      success,
    });
  } catch {
    // don't fail the user-visible run if audit insert fails
  }

  const body = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return [
    `[${cmd.slug}] risk=${cmd.risk_level} snip=${result.usedSnip ? "yes" : "no"} exit=${result.status ?? "?"}`,
    body || "(no output)",
  ].join("\n");
}
