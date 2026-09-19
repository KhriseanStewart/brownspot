import fs from "node:fs";
import path from "node:path";
import { BROWNSPOT_MAX_REFS, BROWNSPOT_REF_EMBEDDINGS } from "../../config.ts";
import { style } from "../style.ts";
import { assertSafeProjectPath } from "./ignore.ts";
import { ingestBySlug, ingestProject } from "./ingest.ts";
import {
  canAddReference,
  getProjectBySlug,
  latestEvents,
  listProjects,
  removeProject,
  slugify,
  upsertProject,
} from "./store.ts";

function helpText(): string {
  return `Reference / project RAG commands:
  /refs                 List projects (reference + active)
  /refs add <path>      Add a reference project (max ${BROWNSPOT_MAX_REFS})
  /refs remove <slug>   Remove a project by slug
  /refs reindex [slug]  Reindex one or all projects
  /refs status          Added vs last ingested (+ recent events)

cwd is the active project (auto-indexed). Refs are style/structure teachers.
Default retrieval = Postgres FTS. Embeddings: ${BROWNSPOT_REF_EMBEDDINGS ? "ON" : "OFF"} (BROWNSPOT_REF_EMBEDDINGS).
`;
}

export async function handleRefsCommand(
  line: string,
  clerkUserId: string,
): Promise<boolean> {
  if (!line.startsWith("/refs") && !line.startsWith("/projects")) return false;

  const prefix = line.startsWith("/projects") ? "/projects" : "/refs";
  const rest = line.slice(prefix.length).trim();
  const space = rest.search(/\s/);
  const cmd = (space === -1 ? rest || "list" : rest.slice(0, space)).toLowerCase() || "list";
  const arg = space === -1 ? "" : rest.slice(space + 1).trim();

  try {
    switch (cmd) {
      case "help":
        console.log(helpText());
        return true;

      case "list":
      case "": {
        const projects = await listProjects(clerkUserId);
        if (!projects.length) {
          console.log(style.dim("(none — /refs add <path> or restart to set refs)"));
          return true;
        }
        for (const p of projects) {
          const flag = p.enabled ? "" : style.dim(" [disabled]");
          console.log(
            `• ${style.bold(p.slug)} ${style.dim(`[${p.project_role}]`)} — ${p.label}${flag}`,
          );
          console.log(style.dim(`  ${p.local_path}`));
        }
        return true;
      }

      case "add": {
        if (!arg) {
          console.log(style.dim("Usage: /refs add <absolute-or-relative-path>"));
          return true;
        }
        const refs = await listProjects(clerkUserId, { role: "reference" });
        if (!canAddReference(refs.length)) {
          console.log(
            style.yellow(
              `Max ${BROWNSPOT_MAX_REFS} reference projects. /refs remove <slug> first.`,
            ),
          );
          return true;
        }
        const abs = assertSafeProjectPath(arg);
        if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
          console.log(style.yellow(`Not a directory: ${abs}`));
          return true;
        }
        let slug = slugify(abs);
        if (await getProjectBySlug(clerkUserId, slug)) {
          slug = `${slug}-${Date.now().toString(36).slice(-4)}`;
        }
        const project = await upsertProject({
          clerkUserId,
          slug,
          label: path.basename(abs),
          localPath: abs,
          projectRole: "reference",
        });
        console.log(style.green(`Added ${slug}. Ingesting…`));
        const result = await ingestProject(project);
        console.log(
          style.dim(
            `${result.status} · files ${result.fileCount} · chunks ${result.chunkCount}` +
              (result.error ? ` · ${result.error}` : ""),
          ),
        );
        return true;
      }

      case "remove": {
        if (!arg) {
          console.log(style.dim("Usage: /refs remove <slug>"));
          return true;
        }
        const ok = await removeProject(clerkUserId, arg);
        console.log(ok ? style.green(`Removed ${arg}`) : style.yellow(`Not found: ${arg}`));
        return true;
      }

      case "reindex": {
        if (arg) {
          console.log(style.dim(`Reindexing ${arg}…`));
          const result = await ingestBySlug(clerkUserId, arg, { force: true });
          console.log(
            style.dim(
              `${result.status} · files ${result.fileCount} · chunks ${result.chunkCount}` +
                (result.error ? ` · ${result.error}` : ""),
            ),
          );
          return true;
        }
        const all = await listProjects(clerkUserId, { enabledOnly: true });
        for (const p of all) {
          console.log(style.dim(`Reindexing ${p.slug}…`));
          const result = await ingestProject(p, { force: true });
          console.log(
            style.dim(
              `  ${result.status} · files ${result.fileCount} · chunks ${result.chunkCount}`,
            ),
          );
        }
        if (!all.length) console.log(style.dim("(no projects)"));
        return true;
      }

      case "status": {
        const projects = await listProjects(clerkUserId);
        if (!projects.length) {
          console.log(style.dim("(no projects)"));
          return true;
        }
        console.log(
          style.dim(
            `embeddings=${BROWNSPOT_REF_EMBEDDINGS ? "on" : "off"} · max_refs=${BROWNSPOT_MAX_REFS}`,
          ),
        );
        for (const p of projects) {
          const added = new Date(p.created_at).toISOString();
          const ingested = p.last_ingest_at
            ? new Date(p.last_ingest_at).toISOString()
            : "never";
          console.log(
            `\n${style.bold(p.slug)} [${p.project_role}] ${p.enabled ? "on" : "off"}`,
          );
          console.log(style.dim(`  path     ${p.local_path}`));
          console.log(style.dim(`  added    ${added}`));
          console.log(style.dim(`  ingested ${ingested}`));
          if (p.last_content_hash) {
            console.log(style.dim(`  hash     ${p.last_content_hash.slice(0, 12)}…`));
          }
          const events = await latestEvents(p.id, 4);
          for (const ev of events) {
            console.log(
              style.dim(
                `  event    ${ev.event_type} @ ${new Date(ev.created_at).toISOString()}`,
              ),
            );
          }
        }
        return true;
      }

      default:
        console.log(style.yellow(`Unknown /refs command: ${cmd}`));
        console.log(helpText());
        return true;
    }
  } catch (e) {
    console.log(style.red(e instanceof Error ? e.message : String(e)));
    return true;
  }
}
