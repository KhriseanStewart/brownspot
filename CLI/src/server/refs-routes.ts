/**
 * Hosted refs API — same Railway Postgres the server already uses.
 * CLI calls these when it has no local DATABASE_URL (installed binary).
 */
import { Hono } from "hono";
import { getDb } from "../db/client.ts";
import { BROWNSPOT_MAX_REFS } from "../config.ts";
import { requireAuth } from "./auth-middleware.ts";
import type { ProjectRole, ReferenceProject } from "../agent/refs/types.ts";
import { buildFtsQuery } from "../agent/refs/search.ts";
import { REF_SEARCH_LIMIT } from "../config.ts";

export const refsApi = new Hono();

refsApi.use("/v1/refs/*", requireAuth);

refsApi.get("/v1/refs/projects", async (c) => {
  const user = c.get("authUser");
  const role = c.req.query("role") as ProjectRole | undefined;
  const enabledOnly = c.req.query("enabledOnly") === "1";
  const db = getDb();
  let projects: ReferenceProject[];
  if (role && enabledOnly) {
    projects = await db`
      SELECT * FROM reference_projects
      WHERE clerk_user_id = ${user.clerkUserId}
        AND project_role = ${role} AND enabled = TRUE
      ORDER BY sort_order ASC, id ASC
    `;
  } else if (role) {
    projects = await db`
      SELECT * FROM reference_projects
      WHERE clerk_user_id = ${user.clerkUserId} AND project_role = ${role}
      ORDER BY sort_order ASC, id ASC
    `;
  } else if (enabledOnly) {
    projects = await db`
      SELECT * FROM reference_projects
      WHERE clerk_user_id = ${user.clerkUserId} AND enabled = TRUE
      ORDER BY project_role ASC, sort_order ASC, id ASC
    `;
  } else {
    projects = await db`
      SELECT * FROM reference_projects
      WHERE clerk_user_id = ${user.clerkUserId}
      ORDER BY project_role ASC, sort_order ASC, id ASC
    `;
  }
  return c.json({ projects });
});

refsApi.get("/v1/refs/projects/:slug", async (c) => {
  const user = c.get("authUser");
  const slug = c.req.param("slug");
  const db = getDb();
  const rows = await db<ReferenceProject[]>`
    SELECT * FROM reference_projects
    WHERE clerk_user_id = ${user.clerkUserId} AND slug = ${slug}
    LIMIT 1
  `;
  if (!rows[0]) return c.json({ error: "Not found" }, 404);
  return c.json({ project: rows[0] });
});

refsApi.post("/v1/refs/projects", async (c) => {
  const user = c.get("authUser");
  const body = (await c.req.json()) as {
    slug: string;
    label?: string;
    localPath: string;
    projectRole: ProjectRole;
    enabled?: boolean;
    isPrimary?: boolean;
    sortOrder?: number;
  };
  if (!body.slug || !body.localPath || !body.projectRole) {
    return c.json({ error: "slug, localPath, projectRole required" }, 400);
  }
  const db = getDb();
  if (body.projectRole === "reference") {
    const refs = await db<{ n: number }[]>`
      SELECT count(*)::int AS n FROM reference_projects
      WHERE clerk_user_id = ${user.clerkUserId}
        AND project_role = 'reference'
        AND slug <> ${body.slug}
    `;
    if ((refs[0]?.n ?? 0) >= BROWNSPOT_MAX_REFS) {
      return c.json({ error: `Max reference projects is ${BROWNSPOT_MAX_REFS}` }, 400);
    }
  }
  const rows = await db<ReferenceProject[]>`
    INSERT INTO reference_projects (
      clerk_user_id, slug, label, local_path, project_role,
      enabled, is_primary, sort_order
    ) VALUES (
      ${user.clerkUserId},
      ${body.slug},
      ${body.label ?? body.slug},
      ${body.localPath},
      ${body.projectRole},
      ${body.enabled ?? true},
      ${body.isPrimary ?? body.projectRole === "active"},
      ${body.sortOrder ?? (body.projectRole === "active" ? 0 : 100)}
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
  await db`
    INSERT INTO project_events (project_id, event_type, metadata)
    VALUES (${project.id}, 'added', ${db.json({ role: body.projectRole, path: body.localPath } as never)})
  `;
  return c.json({ project });
});

refsApi.delete("/v1/refs/projects/:slug", async (c) => {
  const user = c.get("authUser");
  const slug = c.req.param("slug");
  const db = getDb();
  const existing = await db<ReferenceProject[]>`
    SELECT * FROM reference_projects
    WHERE clerk_user_id = ${user.clerkUserId} AND slug = ${slug}
    LIMIT 1
  `;
  if (!existing[0]) return c.json({ removed: false });
  await db`
    INSERT INTO project_events (project_id, event_type, metadata)
    VALUES (${existing[0].id}, 'removed', ${db.json({} as never)})
  `;
  await db`
    DELETE FROM reference_projects
    WHERE clerk_user_id = ${user.clerkUserId} AND slug = ${slug}
  `;
  return c.json({ removed: true });
});

refsApi.post("/v1/refs/projects/id/:id/events", async (c) => {
  const user = c.get("authUser");
  const projectId = Number(c.req.param("id"));
  const body = (await c.req.json()) as {
    eventType: string;
    snapshotId?: number | null;
    metadata?: Record<string, unknown>;
  };
  const db = getDb();
  const owned = await db`
    SELECT id FROM reference_projects
    WHERE id = ${projectId} AND clerk_user_id = ${user.clerkUserId}
    LIMIT 1
  `;
  if (!owned[0]) return c.json({ error: "Not found" }, 404);
  await db`
    INSERT INTO project_events (project_id, event_type, snapshot_id, metadata)
    VALUES (
      ${projectId},
      ${body.eventType},
      ${body.snapshotId ?? null},
      ${db.json((body.metadata ?? {}) as never)}
    )
  `;
  return c.json({ ok: true });
});

refsApi.get("/v1/refs/projects/id/:id/events", async (c) => {
  const user = c.get("authUser");
  const projectId = Number(c.req.param("id"));
  const limit = Math.min(Number(c.req.query("limit") ?? 5), 50);
  const db = getDb();
  const owned = await db`
    SELECT id FROM reference_projects
    WHERE id = ${projectId} AND clerk_user_id = ${user.clerkUserId}
    LIMIT 1
  `;
  if (!owned[0]) return c.json({ error: "Not found" }, 404);
  const events = await db`
    SELECT event_type, created_at, metadata
    FROM project_events
    WHERE project_id = ${projectId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return c.json({ events });
});

refsApi.patch("/v1/refs/projects/id/:id/ingest-meta", async (c) => {
  const user = c.get("authUser");
  const projectId = Number(c.req.param("id"));
  const body = (await c.req.json()) as { contentHash: string };
  const db = getDb();
  const result = await db`
    UPDATE reference_projects
    SET last_ingest_at = NOW(),
        last_content_hash = ${body.contentHash},
        updated_at = NOW()
    WHERE id = ${projectId} AND clerk_user_id = ${user.clerkUserId}
    RETURNING id
  `;
  if (!result[0]) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

refsApi.post("/v1/refs/search", async (c) => {
  const user = c.get("authUser");
  const body = (await c.req.json()) as {
    query: string;
    limit?: number;
    roles?: ProjectRole[];
  };
  const q = buildFtsQuery(body.query ?? "");
  if (!q) return c.json({ chunks: [] });
  const limit = body.limit ?? REF_SEARCH_LIMIT;
  const roles = body.roles?.length ? body.roles : (["reference", "active"] as ProjectRole[]);
  const db = getDb();
  const chunks = await db`
    SELECT
      c.id, c.project_id, c.snapshot_id, c.kind, c.path, c.title,
      c.content, c.content_hash, c.metadata,
      p.slug, p.project_role, p.label,
      ts_rank(c.search_vector, websearch_to_tsquery('english', ${q})) AS rank
    FROM project_chunks c
    INNER JOIN reference_projects p ON p.id = c.project_id
    WHERE p.clerk_user_id = ${user.clerkUserId}
      AND p.enabled = TRUE
      AND p.project_role = ANY(${roles})
      AND c.search_vector @@ websearch_to_tsquery('english', ${q})
    ORDER BY
      CASE WHEN p.project_role = 'active' THEN 0 ELSE 1 END,
      rank DESC, c.id DESC
    LIMIT ${limit}
  `;
  return c.json({ chunks });
});

/** Commit a locally walked ingest into Railway. */
refsApi.post("/v1/refs/projects/:slug/ingest", async (c) => {
  const user = c.get("authUser");
  const slug = c.req.param("slug");
  const body = (await c.req.json()) as {
    force?: boolean;
    treeHash: string;
    fileCount: number;
    chunks: Array<{
      kind: string;
      path: string;
      title: string;
      content: string;
      contentHash: string;
      highValue: boolean;
    }>;
    profile?: { summaryMd: string; styleJson: Record<string, unknown> } | null;
  };
  const db = getDb();
  const projects = await db<ReferenceProject[]>`
    SELECT * FROM reference_projects
    WHERE clerk_user_id = ${user.clerkUserId} AND slug = ${slug}
    LIMIT 1
  `;
  const project = projects[0];
  if (!project) return c.json({ error: "Project not found — upsert first" }, 404);

  if (
    !body.force &&
    project.last_content_hash &&
    project.last_content_hash === body.treeHash
  ) {
    const snap = await db<{ id: number }[]>`
      INSERT INTO project_snapshots (project_id, status, file_count, chunk_count)
      VALUES (${project.id}, 'skipped', ${body.fileCount}, 0)
      RETURNING id
    `;
    await db`
      INSERT INTO project_events (project_id, event_type, snapshot_id, metadata)
      VALUES (
        ${project.id}, 'ingested', ${snap[0]?.id ?? null},
        ${db.json({ status: "skipped", reason: "unchanged" } as never)}
      )
    `;
    return c.json({
      status: "skipped",
      fileCount: body.fileCount,
      chunkCount: 0,
      contentHash: body.treeHash,
    });
  }

  const snapRows = await db<{ id: number }[]>`
    INSERT INTO project_snapshots (project_id, status, file_count)
    VALUES (${project.id}, 'running', ${body.fileCount})
    RETURNING id
  `;
  const snapshotId = snapRows[0]!.id;

  try {
    await db`DELETE FROM project_chunks WHERE project_id = ${project.id}`;

    let chunkCount = 0;
    if (body.profile?.summaryMd) {
      await db`
        INSERT INTO project_profiles (project_id, summary_md, style_json, updated_at)
        VALUES (
          ${project.id},
          ${body.profile.summaryMd},
          ${db.json((body.profile.styleJson ?? {}) as never)},
          NOW()
        )
        ON CONFLICT (project_id) DO UPDATE SET
          summary_md = EXCLUDED.summary_md,
          style_json = EXCLUDED.style_json,
          updated_at = NOW()
      `;
      await db`
        INSERT INTO project_chunks (
          project_id, snapshot_id, kind, path, title, content, content_hash, metadata
        ) VALUES (
          ${project.id}, ${snapshotId}, 'profile', '', 'Coding profile',
          ${body.profile.summaryMd}, ${body.treeHash + ":profile"},
          ${db.json({ style: body.profile.styleJson ?? {} } as never)}
        )
      `;
      chunkCount++;
    }

    for (const ch of body.chunks ?? []) {
      await db`
        INSERT INTO project_chunks (
          project_id, snapshot_id, kind, path, title, content, content_hash, metadata
        ) VALUES (
          ${project.id}, ${snapshotId}, ${ch.kind}, ${ch.path}, ${ch.title},
          ${ch.content}, ${ch.contentHash},
          ${db.json({ high_value: ch.highValue } as never)}
        )
      `;
      chunkCount++;
    }

    await db`
      UPDATE project_snapshots
      SET status = 'ok', chunk_count = ${chunkCount}
      WHERE id = ${snapshotId}
    `;
    await db`
      UPDATE reference_projects
      SET last_ingest_at = NOW(),
          last_content_hash = ${body.treeHash},
          updated_at = NOW()
      WHERE id = ${project.id}
    `;
    await db`
      INSERT INTO project_events (project_id, event_type, snapshot_id, metadata)
      VALUES (
        ${project.id},
        ${body.force ? "reindexed" : "ingested"},
        ${snapshotId},
        ${db.json({ status: "ok", fileCount: body.fileCount, chunkCount } as never)}
      )
    `;

    return c.json({
      status: "ok",
      fileCount: body.fileCount,
      chunkCount,
      contentHash: body.treeHash,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db`
      UPDATE project_snapshots SET status = 'error', error = ${msg}
      WHERE id = ${snapshotId}
    `;
    return c.json({
      status: "error",
      fileCount: body.fileCount,
      chunkCount: 0,
      contentHash: body.treeHash,
      error: msg,
    });
  }
});
