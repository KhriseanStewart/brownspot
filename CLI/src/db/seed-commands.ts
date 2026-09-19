#!/usr/bin/env bun
/**
 * Upsert the starter agent command catalog into Postgres.
 * Safe to re-run. Add more rows here (or INSERT in SQL) anytime.
 */
import { getDb, closeDb } from "./client.ts";

type Seed = {
  slug: string;
  name: string;
  description: string;
  category: string;
  template: string;
  params: Array<{ name: string; required?: boolean; description?: string }>;
  risk: "low" | "medium" | "high" | "critical";
  approval?: boolean;
  sort?: number;
};

const SEEDS: Seed[] = [
  // —— git ——
  { slug: "git.status", name: "Git status", description: "Show working tree status", category: "git", template: "git status -sb", params: [], risk: "low", approval: false, sort: 10 },
  { slug: "git.diff", name: "Git diff", description: "Show unstaged diffs", category: "git", template: "git diff", params: [], risk: "low", approval: false, sort: 11 },
  { slug: "git.diff_staged", name: "Git diff staged", description: "Show staged diffs", category: "git", template: "git diff --cached", params: [], risk: "low", approval: false, sort: 11 },
  { slug: "git.log", name: "Git log", description: "Recent commits", category: "git", template: "git log --oneline -n {{count}}", params: [{ name: "count", required: false, description: "Number of commits (default 15)" }], risk: "low", approval: false, sort: 12 },
  { slug: "git.branch", name: "Git branch list", description: "List local branches", category: "git", template: "git branch -vv", params: [], risk: "low", approval: false, sort: 13 },
  { slug: "git.fetch", name: "Git fetch", description: "Fetch from remote", category: "git", template: "git fetch --all --prune", params: [], risk: "medium", approval: true, sort: 14 },
  { slug: "git.pull", name: "Git pull", description: "Pull current branch", category: "git", template: "git pull", params: [], risk: "medium", approval: true, sort: 15 },
  { slug: "git.add", name: "Git add", description: "Stage files (pathspec)", category: "git", template: "git add -- {{paths}}", params: [{ name: "paths", required: true, description: "Paths to stage, e.g. . or src/a.ts" }], risk: "medium", approval: true, sort: 16 },
  { slug: "git.commit", name: "Git commit", description: "Create a commit (uses local git identity/signing)", category: "git", template: "git commit -m {{message}}", params: [{ name: "message", required: true, description: "Commit message" }], risk: "high", approval: true, sort: 17 },
  { slug: "git.push", name: "Git push", description: "Push current branch to remote", category: "git", template: "git push {{remote}} {{branch}}", params: [{ name: "remote", required: false, description: "Remote name (default origin)" }, { name: "branch", required: false, description: "Branch (default HEAD)" }], risk: "high", approval: true, sort: 18 },
  { slug: "git.push_upstream", name: "Git push -u", description: "Push and set upstream", category: "git", template: "git push -u {{remote}} HEAD", params: [{ name: "remote", required: false, description: "Remote (default origin)" }], risk: "high", approval: true, sort: 19 },
  { slug: "git.checkout", name: "Git checkout branch", description: "Switch branches", category: "git", template: "git checkout {{branch}}", params: [{ name: "branch", required: true, description: "Branch name" }], risk: "medium", approval: true, sort: 20 },
  { slug: "git.checkout_new", name: "Git create branch", description: "Create and switch to a new branch", category: "git", template: "git checkout -b {{branch}}", params: [{ name: "branch", required: true, description: "New branch name" }], risk: "medium", approval: true, sort: 21 },

  // —— github (gh) ——
  { slug: "gh.auth_status", name: "GitHub auth status", description: "Show gh auth status", category: "github", template: "gh auth status", params: [], risk: "low", approval: false, sort: 30 },
  { slug: "gh.repo_view", name: "GitHub repo view", description: "View current or named repo", category: "github", template: "gh repo view {{repo}}", params: [{ name: "repo", required: false, description: "owner/name (empty = current)" }], risk: "low", approval: false, sort: 31 },
  { slug: "gh.pr.list", name: "List pull requests", description: "List open PRs", category: "github", template: "gh pr list --limit {{limit}}", params: [{ name: "limit", required: false, description: "Max PRs (default 20)" }], risk: "low", approval: false, sort: 32 },
  { slug: "gh.pr.view", name: "View pull request", description: "View a PR by number", category: "github", template: "gh pr view {{number}}", params: [{ name: "number", required: true, description: "PR number" }], risk: "low", approval: false, sort: 33 },
  { slug: "gh.pr.create", name: "Create pull request", description: "Open a PR with title/body", category: "github", template: "gh pr create --title {{title}} --body {{body}}", params: [{ name: "title", required: true, description: "PR title" }, { name: "body", required: true, description: "PR body markdown" }], risk: "high", approval: true, sort: 34 },
  { slug: "gh.pr.merge", name: "Merge pull request", description: "Merge a PR by number", category: "github", template: "gh pr merge {{number}} --merge", params: [{ name: "number", required: true, description: "PR number" }], risk: "critical", approval: true, sort: 35 },
  { slug: "gh.issue.list", name: "List issues", description: "List open issues", category: "github", template: "gh issue list --limit {{limit}}", params: [{ name: "limit", required: false, description: "Max issues (default 20)" }], risk: "low", approval: false, sort: 36 },
  { slug: "gh.release.list", name: "List releases", description: "List GitHub releases", category: "github", template: "gh release list --limit {{limit}}", params: [{ name: "limit", required: false, description: "Max releases (default 10)" }], risk: "low", approval: false, sort: 37 },
  { slug: "gh.workflow.list", name: "List workflows", description: "List Actions workflows", category: "github", template: "gh workflow list", params: [], risk: "low", approval: false, sort: 38 },
  { slug: "gh.run.list", name: "List workflow runs", description: "Recent Actions runs", category: "github", template: "gh run list --limit {{limit}}", params: [{ name: "limit", required: false, description: "Max runs (default 10)" }], risk: "low", approval: false, sort: 39 },

  // —— ssh / remote ——
  { slug: "ssh.run", name: "SSH remote command", description: "Run a command on a remote host over SSH", category: "ssh", template: "ssh -o BatchMode=yes -o ConnectTimeout=15 {{userhost}} -- {{remote_command}}", params: [{ name: "userhost", required: true, description: "user@host" }, { name: "remote_command", required: true, description: "Command to run remotely" }], risk: "critical", approval: true, sort: 50 },
  { slug: "ssh.check", name: "SSH connectivity check", description: "Test SSH login (BatchMode)", category: "ssh", template: "ssh -o BatchMode=yes -o ConnectTimeout=10 {{userhost}} -- echo ok", params: [{ name: "userhost", required: true, description: "user@host" }], risk: "high", approval: true, sort: 51 },
  { slug: "scp.upload", name: "SCP upload", description: "Copy a local file to remote", category: "ssh", template: "scp -o BatchMode=yes {{local_path}} {{userhost}}:{{remote_path}}", params: [{ name: "local_path", required: true, description: "Local file path" }, { name: "userhost", required: true, description: "user@host" }, { name: "remote_path", required: true, description: "Remote destination path" }], risk: "critical", approval: true, sort: 52 },
  { slug: "scp.download", name: "SCP download", description: "Copy a remote file locally", category: "ssh", template: "scp -o BatchMode=yes {{userhost}}:{{remote_path}} {{local_path}}", params: [{ name: "userhost", required: true, description: "user@host" }, { name: "remote_path", required: true, description: "Remote file path" }, { name: "local_path", required: true, description: "Local destination path" }], risk: "high", approval: true, sort: 53 },

  // —— package / build ——
  { slug: "bun.install", name: "Bun install", description: "Install JS deps with Bun", category: "package", template: "bun install", params: [], risk: "medium", approval: true, sort: 60 },
  { slug: "bun.test", name: "Bun test", description: "Run Bun tests", category: "package", template: "bun test {{path}}", params: [{ name: "path", required: false, description: "Optional test path" }], risk: "low", approval: false, sort: 61 },
  { slug: "bun.typecheck", name: "Typecheck", description: "Run tsc --noEmit via bun", category: "package", template: "bun run typecheck", params: [], risk: "low", approval: false, sort: 62 },
  { slug: "npm.test", name: "npm test", description: "Run npm test", category: "package", template: "npm test -- {{args}}", params: [{ name: "args", required: false, description: "Extra args" }], risk: "low", approval: false, sort: 63 },

  // —— docker ——
  { slug: "docker.ps", name: "Docker ps", description: "List running containers", category: "docker", template: "docker ps", params: [], risk: "low", approval: false, sort: 70 },
  { slug: "docker.logs", name: "Docker logs", description: "Tail container logs", category: "docker", template: "docker logs --tail {{tail}} {{container}}", params: [{ name: "container", required: true, description: "Container name/id" }, { name: "tail", required: false, description: "Lines (default 100)" }], risk: "low", approval: false, sort: 71 },
  { slug: "docker.compose_ps", name: "Compose ps", description: "docker compose ps", category: "docker", template: "docker compose ps", params: [], risk: "low", approval: false, sort: 72 },

  // —— network ——
  { slug: "curl.get", name: "HTTP GET", description: "Fetch a URL with curl", category: "network", template: "curl -fsSL -m 30 {{url}}", params: [{ name: "url", required: true, description: "https URL" }], risk: "medium", approval: true, sort: 80 },
  { slug: "curl.post_json", name: "HTTP POST JSON", description: "POST JSON body", category: "network", template: "curl -fsSL -m 30 -X POST -H 'Content-Type: application/json' -d {{body}} {{url}}", params: [{ name: "url", required: true, description: "https URL" }, { name: "body", required: true, description: "JSON string" }], risk: "high", approval: true, sort: 81 },
  { slug: "dig.lookup", name: "DNS lookup", description: "dig a hostname", category: "network", template: "dig +short {{host}}", params: [{ name: "host", required: true, description: "Hostname" }], risk: "low", approval: false, sort: 82 },
  { slug: "ping.host", name: "Ping host", description: "Ping 3 times", category: "network", template: "ping -c 3 {{host}}", params: [{ name: "host", required: true, description: "Host or IP" }], risk: "low", approval: false, sort: 83 },

  // —— system ——
  { slug: "sys.pwd", name: "Print working directory", description: "pwd", category: "system", template: "pwd", params: [], risk: "low", approval: false, sort: 90 },
  { slug: "sys.env_which", name: "Which binary", description: "Locate a binary on PATH", category: "system", template: "which {{name}}", params: [{ name: "name", required: true, description: "Binary name" }], risk: "low", approval: false, sort: 91 },
  { slug: "sys.disk", name: "Disk usage", description: "df -h", category: "system", template: "df -h", params: [], risk: "low", approval: false, sort: 92 },
  { slug: "sys.open", name: "Open path/URL", description: "macOS open / xdg-open", category: "system", template: "open {{target}} 2>/dev/null || xdg-open {{target}}", params: [{ name: "target", required: true, description: "File path or URL" }], risk: "medium", approval: true, sort: 93 },

  // —— database ——
  { slug: "db.migrate", name: "Run DB migrations", description: "bun run db:migrate against configured DATABASE_URL", category: "database", template: "bun run db:migrate", params: [], risk: "high", approval: true, sort: 100 },
  { slug: "db.psql_version", name: "Postgres version", description: "SELECT version() via psql if available", category: "database", template: "psql \"$DATABASE_URL\" -c 'SELECT version();'", params: [], risk: "medium", approval: true, sort: 101 },

  // —— cloudflare / ops (future-friendly) ——
  { slug: "cf.tunnel_info", name: "Cloudflared tunnel info", description: "Show named tunnel info", category: "cloud", template: "cloudflared tunnel info {{name}}", params: [{ name: "name", required: false, description: "Tunnel name (default brownspot-api)" }], risk: "low", approval: false, sort: 110 },
];


async function main() {
  const db = getDb();
  let n = 0;
  for (const s of SEEDS) {
    await db`
      INSERT INTO agent_commands (
        slug, name, description, category, handler_type, template,
        params_schema, risk_level, requires_approval, enabled, sort_order
      ) VALUES (
        ${s.slug},
        ${s.name},
        ${s.description},
        ${s.category},
        'shell_template',
        ${s.template},
        ${db.json({ params: s.params })},
        ${s.risk},
        ${s.approval ?? true},
        TRUE,
        ${s.sort ?? 100}
      )
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        category = EXCLUDED.category,
        handler_type = EXCLUDED.handler_type,
        template = EXCLUDED.template,
        params_schema = EXCLUDED.params_schema,
        risk_level = EXCLUDED.risk_level,
        requires_approval = EXCLUDED.requires_approval,
        enabled = TRUE,
        sort_order = EXCLUDED.sort_order,
        updated_at = NOW()
    `;
    n++;
  }
  console.log(`Seeded/upserted ${n} agent commands`);
  await closeDb();
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
