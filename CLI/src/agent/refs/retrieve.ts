import { getAgentUserId } from "../../config.ts";
import { getDb } from "../../db/client.ts";
import { searchReferenceContext, packChunks } from "./search.ts";
import { formatRefsSystemNote } from "./prompt.ts";
import type { RetrievedChunk } from "./types.ts";

/** Best-effort FTS retrieval for a coding turn. Never throws. */
export async function retrieveForTurn(
  userText: string,
  clerkUserId?: string,
): Promise<{ note: string; chunks: RetrievedChunk[] }> {
  try {
    const uid = clerkUserId ?? getAgentUserId();
    const chunks = await searchReferenceContext({
      clerkUserId: uid,
      query: userText,
    });
    const packed = packChunks(chunks);
    return { note: formatRefsSystemNote(packed), chunks: packed };
  } catch {
    return { note: "", chunks: [] };
  }
}

export async function listProjectsForTool(clerkUserId: string): Promise<string> {
  try {
    const db = getDb();
    const rows = await db<
      Array<{
        slug: string;
        label: string;
        local_path: string;
        project_role: string;
        enabled: boolean;
        last_ingest_at: Date | string | null;
      }>
    >`
      SELECT slug, label, local_path, project_role, enabled, last_ingest_at
      FROM reference_projects
      WHERE clerk_user_id = ${clerkUserId}
      ORDER BY project_role ASC, sort_order ASC, id ASC
    `;
    if (!rows.length) return "(no indexed projects — use /refs add <path>)";
    return rows
      .map((r) => {
        const when = r.last_ingest_at
          ? new Date(r.last_ingest_at).toISOString()
          : "never";
        return `• [${r.project_role}] ${r.slug} — ${r.label}\n  path: ${r.local_path}\n  enabled: ${r.enabled} · last ingest: ${when}`;
      })
      .join("\n");
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}

export async function searchContextForTool(
  clerkUserId: string,
  query: string,
): Promise<string> {
  try {
    const chunks = await searchReferenceContext({ clerkUserId, query });
    const packed = packChunks(chunks);
    if (!packed.length) return "(no matching chunks)";
    return packed
      .map(
        (c) =>
          `### [${c.project_role}:${c.slug}] ${c.path || c.kind}\n${c.content}`,
      )
      .join("\n\n");
  } catch (e) {
    return `Error: ${e instanceof Error ? e.message : String(e)}`;
  }
}
