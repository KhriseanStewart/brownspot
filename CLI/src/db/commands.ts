import { getDb } from "./client.ts";

export type AgentCommand = {
  id: number;
  slug: string;
  name: string;
  description: string;
  category: string;
  handler_type: "shell_template" | "builtin";
  template: string | null;
  params_schema: { params?: Array<{ name: string; required?: boolean; description?: string }> };
  risk_level: "low" | "medium" | "high" | "critical";
  requires_approval: boolean;
  enabled: boolean;
  sort_order: number;
};

export async function listAgentCommands(opts?: {
  category?: string;
  q?: string;
}): Promise<AgentCommand[]> {
  const db = getDb();
  const category = opts?.category?.trim() || null;
  const q = opts?.q?.trim() || null;
  const rows = await db<AgentCommand[]>`
    SELECT id, slug, name, description, category, handler_type, template,
           params_schema, risk_level, requires_approval, enabled, sort_order
    FROM agent_commands
    WHERE enabled = TRUE
      AND (${category}::text IS NULL OR category = ${category})
      AND (
        ${q}::text IS NULL
        OR slug ILIKE ${"%" + (q ?? "") + "%"}
        OR name ILIKE ${"%" + (q ?? "") + "%"}
        OR description ILIKE ${"%" + (q ?? "") + "%"}
      )
    ORDER BY sort_order ASC, slug ASC
  `;
  return rows;
}

export async function getAgentCommand(slug: string): Promise<AgentCommand | null> {
  const db = getDb();
  const rows = await db<AgentCommand[]>`
    SELECT id, slug, name, description, category, handler_type, template,
           params_schema, risk_level, requires_approval, enabled, sort_order
    FROM agent_commands
    WHERE slug = ${slug} AND enabled = TRUE
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listCommandCategories(): Promise<string[]> {
  const db = getDb();
  const rows = await db<{ category: string }[]>`
    SELECT DISTINCT category FROM agent_commands WHERE enabled = TRUE ORDER BY category
  `;
  return rows.map((r) => r.category);
}

export async function recordCommandRun(input: {
  slug: string;
  clerkUserId?: string | null;
  params: Record<string, string>;
  resolvedCmd: string;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  success: boolean;
}): Promise<void> {
  const db = getDb();
  await db`
    INSERT INTO agent_command_runs (
      command_slug, clerk_user_id, params, resolved_cmd, exit_code,
      stdout_excerpt, stderr_excerpt, success
    ) VALUES (
      ${input.slug},
      ${input.clerkUserId ?? null},
      ${db.json(input.params)},
      ${input.resolvedCmd},
      ${input.exitCode},
      ${input.stdout.slice(0, 4000)},
      ${input.stderr.slice(0, 2000)},
      ${input.success}
    )
  `;
}
