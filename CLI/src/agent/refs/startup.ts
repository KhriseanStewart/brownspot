import fs from "node:fs";
import path from "node:path";
import type * as readline from "node:readline/promises";
import { BROWNSPOT_MAX_REFS, WORKSPACE, shouldUseRemoteDb, BROWNSPOT_API_URL } from "../../config.ts";
import { style } from "../style.ts";
import { assertSafeProjectPath } from "./ignore.ts";
import { ingestProject } from "./ingest.ts";
import {
  canAddReference,
  getProjectBySlug,
  listProjects,
  recordEvent,
  slugify,
  upsertProject,
} from "./store.ts";

/** Ensure cwd is registered as the active project and ingest if needed. */
export async function ensureActiveProject(
  clerkUserId: string,
  cwd = WORKSPACE,
): Promise<void> {
  let abs: string;
  try {
    abs = assertSafeProjectPath(cwd);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) return;
  } catch {
    return;
  }

  const slug = `active-${slugify(abs)}`;
  const existing = await getProjectBySlug(clerkUserId, slug);
  const project =
    existing ??
    (await upsertProject({
      clerkUserId,
      slug,
      label: path.basename(abs),
      localPath: abs,
      projectRole: "active",
      isPrimary: true,
      sortOrder: 0,
    }));

  if (existing && existing.local_path !== abs) {
    await upsertProject({
      clerkUserId,
      slug,
      label: path.basename(abs),
      localPath: abs,
      projectRole: "active",
      isPrimary: true,
      sortOrder: 0,
    });
  }

  await recordEvent(project.id, "activated", { metadata: { path: abs } }).catch(
    () => undefined,
  );
}

/** Re-ingest active project when content hash may have changed (eager). */
export async function maybeReingestActive(
  clerkUserId: string,
  cwd = WORKSPACE,
): Promise<void> {
  const actives = await listProjects(clerkUserId, {
    role: "active",
    enabledOnly: true,
  });
  const abs = path.resolve(cwd);
  const match =
    actives.find((p) => path.resolve(p.local_path) === abs) ?? actives[0];
  if (!match) return;
  // Force=false → hash short-circuit when unchanged
  await ingestProject(match, { force: false });
}

function printRefsBanner(count: number): void {
  const slots = `${count}/${BROWNSPOT_MAX_REFS}`;
  console.log("");
  console.log(style.bold("Reference projects") + style.dim(`  (${slots} slots)`));
  console.log(
    style.dim(
      "Teachers for how you structure code. This folder is already indexed as active.",
    ),
  );
  console.log(
    style.dim(
      "Paste a folder path (quotes OK · ~ OK). Commands: done · skip · help · list",
    ),
  );
  console.log("");
}

/**
 * Optional prompt after login: add 0–3 reference paths. Skip allowed.
 * Accepts quoted paths from drag-drop / Finder paste.
 */
export async function promptOptionalRefs(
  rl: readline.Interface,
  clerkUserId: string,
): Promise<void> {
  const existing = await listProjects(clerkUserId, { role: "reference" });
  if (existing.length > 0) {
    console.log(
      style.dim(
        `refs · ${existing.length}/${BROWNSPOT_MAX_REFS} reference(s) ready · /refs status`,
      ),
    );
    return;
  }

  printRefsBanner(existing.length);

  let count = existing.length;
  const added: string[] = [];

  while (count < BROWNSPOT_MAX_REFS) {
    const answer = (
      await rl.question(
        `${style.cyan("path")} ${style.dim(`[${count + 1}/${BROWNSPOT_MAX_REFS}] or done`)} › `,
      )
    ).trim();

    if (!answer || /^(done|skip|s|q|quit|no)$/i.test(answer)) {
      break;
    }
    if (/^(help|\?|h)$/i.test(answer)) {
      console.log(
        style.dim(
          [
            "  Example: /Users/you/dev/projects/EXPO/my-app",
            "  Tip: drag a folder into the terminal, or paste — quotes are stripped.",
            "  Later: /refs add · /refs status · /refs remove <slug>",
          ].join("\n"),
        ),
      );
      continue;
    }
    if (/^list$/i.test(answer)) {
      if (!added.length) console.log(style.dim("  (none added yet this session)"));
      else for (const a of added) console.log(style.dim(`  • ${a}`));
      continue;
    }

    if (!canAddReference(count)) {
      console.log(style.yellow(`  Max ${BROWNSPOT_MAX_REFS} references.`));
      break;
    }

    try {
      const abs = assertSafeProjectPath(answer);
      if (!fs.existsSync(abs)) {
        console.log(style.yellow(`  Path not found: ${abs}`));
        console.log(style.dim("  Tip: drop quotes if paste failed, or use ~/…"));
        continue;
      }
      if (!fs.statSync(abs).isDirectory()) {
        console.log(style.yellow(`  Not a folder: ${abs}`));
        continue;
      }
      let slug = slugify(abs);
      if (await getProjectBySlug(clerkUserId, slug)) {
        slug = `${slug}-${count + 1}`;
      }
      const project = await upsertProject({
        clerkUserId,
        slug,
        label: path.basename(abs),
        localPath: abs,
        projectRole: "reference",
        sortOrder: 100 + count,
      });
      console.log(style.green(`  ✓ ${path.basename(abs)}`) + style.dim(` (${slug}) · indexing…`));
      const result = await ingestProject(project);
      const ok = result.status === "ok" || result.status === "skipped";
      console.log(
        style.dim(
          `    ${ok ? "ready" : result.status} · ${result.fileCount} files · ${result.chunkCount} chunks` +
            (result.error ? ` · ${result.error}` : ""),
        ),
      );
      added.push(`${slug} → ${abs}`);
      count++;
      if (count < BROWNSPOT_MAX_REFS) {
        console.log(style.dim(`  Add another? (${count}/${BROWNSPOT_MAX_REFS}) · Enter = done`));
      }
    } catch (e) {
      console.log(style.red(`  ${e instanceof Error ? e.message : String(e)}`));
    }
  }

  if (added.length) {
    console.log(style.green(`refs · ${added.length} reference(s) ready`) + style.dim(" · /refs status anytime"));
  } else {
    console.log(style.dim("refs · skipped — add later with /refs add <path>"));
  }
  console.log("");
}

/** Full startup: active project + optional refs prompt + eager active reindex. */
export async function runRefsStartup(
  rl: readline.Interface,
  clerkUserId: string,
): Promise<void> {
  try {
    if (shouldUseRemoteDb()) {
      console.log(style.dim(`refs · hosted DB via ${BROWNSPOT_API_URL}`));
    }
    await ensureActiveProject(clerkUserId, WORKSPACE);
    await promptOptionalRefs(rl, clerkUserId);
    console.log(style.dim("refs · refreshing active project index…"));
    await maybeReingestActive(clerkUserId, WORKSPACE);
  } catch (e) {
    const msg = (e instanceof Error ? e.message : String(e)).trim() || "database unavailable";
    console.log(style.dim(`refs · skipped (${msg})`));
    if (shouldUseRemoteDb()) {
      console.log(style.dim("  Hosted refs API failed — is the BrownSpot API up?"));
    } else {
      console.log(style.dim("  Set DATABASE_URL or use hosted API after login."));
    }
  }
}
