import fs from "node:fs";
import path from "node:path";
import { getDb } from "../../db/client.ts";
import { AGENT_HOME, ensureAgentDirs } from "../memory/paths.ts";
import { BROWNSPOT_MAX_REFS, shouldUseRemoteDb } from "../../config.ts";
import {
  remoteGetProject,
  remoteLatestEvents,
  remoteListProjects,
  remoteRecordEvent,
  remoteRemoveProject,
  remoteUpdateIngestMeta,
  remoteUpsertProject,
} from "./remote.ts";
import type {
  ProjectEventType,
  ProjectRole,
  ReferenceProject,
  RefsCacheFile,
} from "./types.ts";

const REFS_CACHE = path.join(AGENT_HOME, "refs.json");

export function refsCachePath(): string {
  return REFS_CACHE;
}

export function slugify(input: string): string {
  const base = path.basename(path.resolve(input));
  const slug = base
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "project";
}

export function canAddReference(
  currentReferenceCount: number,
  maxRefs = BROWNSPOT_MAX_REFS,
): boolean {
  return currentReferenceCount < maxRefs;
}

export async function listProjects(
  clerkUserId: string,
  opts?: { role?: ProjectRole; enabledOnly?: boolean },
): Promise<ReferenceProject[]> {
  if (shouldUseRemoteDb()) return remoteListProjects(opts);
  const db = getDb();
  const role = opts?.role;
  const enabledOnly = opts?.enabledOnly ?? false;
  if (role && enabledOnly) {
    return db<ReferenceProject[]>`
      SELECT * FROM reference_projects
      WHERE clerk_user_id = ${clerkUserId}
        AND project_role = ${role}
        AND enabled = TRUE
      ORDER BY sort_order ASC, id ASC
    `;
  }
  if (role) {
    return db<ReferenceProject[]>`
      SELECT * FROM reference_projects
      WHERE clerk_user_id = ${clerkUserId}
        AND project_role = ${role}
      ORDER BY sort_order ASC, id ASC
    `;
  }
  if (enabledOnly) {
    return db<ReferenceProject[]>`
      SELECT * FROM reference_projects
      WHERE clerk_user_id = ${clerkUserId}
        AND enabled = TRUE
      ORDER BY project_role ASC, sort_order ASC, id ASC
    `;
  }
  return db<ReferenceProject[]>`
    SELECT * FROM reference_projects
    WHERE clerk_user_id = ${clerkUserId}
    ORDER BY project_role ASC, sort_order ASC, id ASC
  `;
}

export async function getProjectBySlug(
  clerkUserId: string,
  slug: string,
): Promise<ReferenceProject | null> {
  if (shouldUseRemoteDb()) return remoteGetProject(slug);
  const db = getDb();
  const rows = await db<ReferenceProject[]>`
    SELECT * FROM reference_projects
    WHERE clerk_user_id = ${clerkUserId} AND slug = ${slug}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function recordEvent(
  projectId: number,
  eventType: ProjectEventType,
  opts?: { snapshotId?: number | null; metadata?: Record<string, unknown> },
): Promise<void> {
  if (shouldUseRemoteDb()) {
    await remoteRecordEvent(projectId, eventType, opts);
    return;
  }
  const db = getDb();
  await db`
    INSERT INTO project_events (project_id, event_type, snapshot_id, metadata)
    VALUES (
      ${projectId},
      ${eventType},
      ${opts?.snapshotId ?? null},
      ${db.json((opts?.metadata ?? {}) as never)}
    )
  `;
}

export async function upsertProject(input: {
  clerkUserId: string;
  slug: string;
  label?: string;
  localPath: string;
  projectRole: ProjectRole;
  enabled?: boolean;
  isPrimary?: boolean;
  sortOrder?: number;
}): Promise<ReferenceProject> {
  if (shouldUseRemoteDb()) {
    const project = await remoteUpsertProject({
      slug: input.slug,
      label: input.label,
      localPath: input.localPath,
      projectRole: input.projectRole,
      enabled: input.enabled,
      isPrimary: input.isPrimary,
      sortOrder: input.sortOrder,
    });
    await writeRefsCache(input.clerkUserId);
    return project;
  }
  const db = getDb();
  if (input.projectRole === "reference") {
    const refs = await listProjects(input.clerkUserId, { role: "reference" });
    const existing = refs.find((r) => r.slug === input.slug);
    if (!existing && !canAddReference(refs.length)) {
      throw new Error(
        `Max reference projects is ${BROWNSPOT_MAX_REFS}. Remove one with /refs remove <slug>.`,
      );
    }
  }

  const rows = await db<ReferenceProject[]>`
    INSERT INTO reference_projects (
      clerk_user_id, slug, label, local_path, project_role,
      enabled, is_primary, sort_order
    ) VALUES (
      ${input.clerkUserId},
      ${input.slug},
      ${input.label ?? input.slug},
      ${input.localPath},
      ${input.projectRole},
      ${input.enabled ?? true},
      ${input.isPrimary ?? input.projectRole === "active"},
      ${input.sortOrder ?? (input.projectRole === "active" ? 0 : 100)}
    )
    ON CONFLICT (clerk_user_id, slug) DO UPDATE SET
      label = EXCLUDED.label,
      local_path = EXCLUDED.local_path,
      project_role = EXCLUDED.project_role,
      enabled = EXCLUDED.enabled,
      is_primary = EXCLUDED.is_primary,
      sort_order = EXCLUDED.sort_order,
      updated_at = NOW()
    RETURNING *
  `;
  const project = rows[0]!;
  await recordEvent(project.id, "added", {
    metadata: { role: input.projectRole, path: input.localPath },
  });
  await writeRefsCache(input.clerkUserId);
  return project;
}

export async function removeProject(
  clerkUserId: string,
  slug: string,
): Promise<boolean> {
  if (shouldUseRemoteDb()) {
    const ok = await remoteRemoveProject(slug);
    if (ok) await writeRefsCache(clerkUserId);
    return ok;
  }
  const existing = await getProjectBySlug(clerkUserId, slug);
  if (!existing) return false;
  const db = getDb();
  await recordEvent(existing.id, "removed");
  await db`
    DELETE FROM reference_projects
    WHERE clerk_user_id = ${clerkUserId} AND slug = ${slug}
  `;
  await writeRefsCache(clerkUserId);
  return true;
}

export async function updateIngestMeta(
  projectId: number,
  contentHash: string,
): Promise<void> {
  if (shouldUseRemoteDb()) {
    await remoteUpdateIngestMeta(projectId, contentHash);
    return;
  }
  const db = getDb();
  await db`
    UPDATE reference_projects
    SET last_ingest_at = NOW(),
        last_content_hash = ${contentHash},
        updated_at = NOW()
    WHERE id = ${projectId}
  `;
}

export async function latestEvents(
  projectId: number,
  limit = 5,
): Promise<Array<{ event_type: string; created_at: Date | string; metadata: unknown }>> {
  if (shouldUseRemoteDb()) return remoteLatestEvents(projectId, limit);
  const db = getDb();
  return db`
    SELECT event_type, created_at, metadata
    FROM project_events
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
}

export async function writeRefsCache(clerkUserId: string): Promise<void> {
  ensureAgentDirs();
  const projects = await listProjects(clerkUserId);
  const data: RefsCacheFile = {
    version: 1,
    clerkUserId,
    projects: projects.map((p) => ({
      slug: p.slug,
      label: p.label,
      local_path: p.local_path,
      project_role: p.project_role,
      enabled: p.enabled,
      is_primary: p.is_primary,
      sort_order: p.sort_order,
    })),
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(REFS_CACHE, JSON.stringify(data, null, 2) + "\n", "utf8");
}

export function readRefsCache(): RefsCacheFile | null {
  try {
    const raw = fs.readFileSync(REFS_CACHE, "utf8");
    const parsed = JSON.parse(raw) as RefsCacheFile;
    if (parsed?.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}
