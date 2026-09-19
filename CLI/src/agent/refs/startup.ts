import fs from "node:fs";
import path from "node:path";
import type * as readline from "node:readline/promises";
import { BROWNSPOT_MAX_REFS, WORKSPACE } from "../../config.ts";
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

/**
 * Optional prompt after login: add 0–3 reference paths. Skip allowed.
 */
export async function promptOptionalRefs(
  rl: readline.Interface,
  clerkUserId: string,
): Promise<void> {
  const existing = await listProjects(clerkUserId, { role: "reference" });
  if (existing.length > 0) {
    console.log(
      style.dim(
        `refs · ${existing.length}/${BROWNSPOT_MAX_REFS} reference project(s) · /refs status`,
      ),
    );
    return;
  }

  console.log(
    style.dim(
      `Optional: add up to ${BROWNSPOT_MAX_REFS} reference project paths (style/structure teachers).`,
    ),
  );
  console.log(
    style.dim(
      `Enter a path, or press Enter to skip. (${existing.length}/${BROWNSPOT_MAX_REFS} used)`,
    ),
  );

  let count = existing.length;
  while (count < BROWNSPOT_MAX_REFS) {
    const answer = (
      await rl.question(
        `${style.cyan("ref path")} ${style.dim(`(${count}/${BROWNSPOT_MAX_REFS}, Enter=done)`)} › `,
      )
    ).trim();
    if (!answer) break;

    if (!canAddReference(count)) {
      console.log(style.yellow(`Max ${BROWNSPOT_MAX_REFS} references.`));
      break;
    }

    try {
      const abs = assertSafeProjectPath(answer);
      if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
        console.log(style.yellow(`Not a directory: ${abs}`));
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
      console.log(style.green(`Added ref ${slug} → ingesting…`));
      const result = await ingestProject(project);
      console.log(
        style.dim(
          `  ${result.status} · files ${result.fileCount} · chunks ${result.chunkCount}`,
        ),
      );
      count++;
    } catch (e) {
      console.log(style.red(e instanceof Error ? e.message : String(e)));
    }
  }
}

/** Full startup: active project + optional refs prompt + eager active reindex. */
export async function runRefsStartup(
  rl: readline.Interface,
  clerkUserId: string,
): Promise<void> {
  try {
    await ensureActiveProject(clerkUserId, WORKSPACE);
    await promptOptionalRefs(rl, clerkUserId);
    console.log(style.dim("refs · refreshing active project index…"));
    await maybeReingestActive(clerkUserId, WORKSPACE);
  } catch (e) {
    console.log(
      style.dim(
        `refs · skipped (${e instanceof Error ? e.message : String(e)})`,
      ),
    );
  }
}
