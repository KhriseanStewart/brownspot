import { getDb } from "../../db/client.ts";
import { REF_CONTEXT_BUDGET, REF_SEARCH_LIMIT, shouldUseRemoteDb } from "../../config.ts";
import { remoteSearch } from "./remote.ts";
import type { ProjectRole, RetrievedChunk } from "./types.ts";

/**
 * Build a Postgres `websearch_to_tsquery('english', …)`-safe query string.
 * Strips characters that break websearch syntax; collapses whitespace.
 */
export function buildFtsQuery(raw: string): string {
  return raw
    .replace(/[':&|!()<>]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

export type SearchOpts = {
  clerkUserId: string;
  query: string;
  limit?: number;
  roles?: ProjectRole[];
  projectIds?: number[];
};

export async function searchReferenceContext(
  opts: SearchOpts,
): Promise<RetrievedChunk[]> {
  const q = buildFtsQuery(opts.query);
  if (!q) return [];

  if (shouldUseRemoteDb()) {
    return remoteSearch({
      query: opts.query,
      limit: opts.limit,
      roles: opts.roles,
    });
  }

  const limit = opts.limit ?? REF_SEARCH_LIMIT;
  const db = getDb();
  const roles = opts.roles?.length ? opts.roles : (["reference", "active"] as ProjectRole[]);

  const rows = await db<RetrievedChunk[]>`
    SELECT
      c.id,
      c.project_id,
      c.snapshot_id,
      c.kind,
      c.path,
      c.title,
      c.content,
      c.content_hash,
      c.metadata,
      p.slug,
      p.project_role,
      p.label,
      ts_rank(c.search_vector, websearch_to_tsquery('english', ${q})) AS rank
    FROM project_chunks c
    INNER JOIN reference_projects p ON p.id = c.project_id
    WHERE p.clerk_user_id = ${opts.clerkUserId}
      AND p.enabled = TRUE
      AND p.project_role = ANY(${roles})
      AND c.search_vector @@ websearch_to_tsquery('english', ${q})
    ORDER BY
      CASE WHEN p.project_role = 'active' THEN 0 ELSE 1 END,
      rank DESC,
      c.id DESC
    LIMIT ${limit}
  `;
  return rows;
}

/** Pack retrieved chunks into a char budget (default ~3500–4000). */
export function packChunks(
  chunks: RetrievedChunk[],
  budget = REF_CONTEXT_BUDGET,
): RetrievedChunk[] {
  const out: RetrievedChunk[] = [];
  let used = 0;
  for (const c of chunks) {
    const overhead = (c.title?.length ?? 0) + c.path.length + c.slug.length + 40;
    const room = budget - used - overhead;
    if (room <= 40) break;
    const content =
      c.content.length > room ? c.content.slice(0, room) + "…" : c.content;
    out.push({ ...c, content });
    used += overhead + content.length;
  }
  return out;
}
