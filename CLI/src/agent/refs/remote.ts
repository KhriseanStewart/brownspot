/**
 * Hosted-API client for refs when the CLI has no Railway DATABASE_URL.
 * Auth: Clerk access token (same as hosted LLM).
 */
import { BROWNSPOT_API_URL } from "../../config.ts";
import { getValidSession } from "../../auth/session.ts";
import type {
  ProjectEventType,
  ProjectRole,
  ReferenceProject,
  RetrievedChunk,
} from "./types.ts";

async function authHeaders(): Promise<Record<string, string>> {
  const session = await getValidSession();
  if (!session?.accessToken) {
    throw new Error("Not logged in. Run: dotstart login");
  }
  return {
    Authorization: `Bearer ${session.accessToken}`,
    "Content-Type": "application/json",
  };
}

async function api<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const headers = await authHeaders();
  const res = await fetch(`${BROWNSPOT_API_URL}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const err = data as { error?: string | { message?: string } };
    const msg =
      typeof err?.error === "string"
        ? err.error
        : err?.error?.message || text || res.statusText;
    throw new Error(`refs API ${res.status}: ${msg}`);
  }
  return data as T;
}

export async function remoteListProjects(opts?: {
  role?: ProjectRole;
  enabledOnly?: boolean;
}): Promise<ReferenceProject[]> {
  const q = new URLSearchParams();
  if (opts?.role) q.set("role", opts.role);
  if (opts?.enabledOnly) q.set("enabledOnly", "1");
  const qs = q.toString();
  const data = await api<{ projects: ReferenceProject[] }>(
    "GET",
    `/v1/refs/projects${qs ? `?${qs}` : ""}`,
  );
  return data.projects ?? [];
}

export async function remoteGetProject(
  slug: string,
): Promise<ReferenceProject | null> {
  try {
    const data = await api<{ project: ReferenceProject }>(
      "GET",
      `/v1/refs/projects/${encodeURIComponent(slug)}`,
    );
    return data.project ?? null;
  } catch (e) {
    if (e instanceof Error && e.message.includes("404")) return null;
    throw e;
  }
}

export async function remoteUpsertProject(input: {
  slug: string;
  label?: string;
  localPath: string;
  projectRole: ProjectRole;
  enabled?: boolean;
  isPrimary?: boolean;
  sortOrder?: number;
}): Promise<ReferenceProject> {
  const data = await api<{ project: ReferenceProject }>(
    "POST",
    "/v1/refs/projects",
    input,
  );
  return data.project;
}

export async function remoteRemoveProject(slug: string): Promise<boolean> {
  const data = await api<{ removed: boolean }>(
    "DELETE",
    `/v1/refs/projects/${encodeURIComponent(slug)}`,
  );
  return Boolean(data.removed);
}

export async function remoteRecordEvent(
  projectId: number,
  eventType: ProjectEventType,
  opts?: { snapshotId?: number | null; metadata?: Record<string, unknown> },
): Promise<void> {
  await api("POST", `/v1/refs/projects/id/${projectId}/events`, {
    eventType,
    snapshotId: opts?.snapshotId ?? null,
    metadata: opts?.metadata ?? {},
  });
}

export async function remoteUpdateIngestMeta(
  projectId: number,
  contentHash: string,
): Promise<void> {
  await api("PATCH", `/v1/refs/projects/id/${projectId}/ingest-meta`, {
    contentHash,
  });
}

export async function remoteLatestEvents(
  projectId: number,
  limit = 5,
): Promise<Array<{ event_type: string; created_at: Date | string; metadata: unknown }>> {
  const data = await api<{
    events: Array<{ event_type: string; created_at: Date | string; metadata: unknown }>;
  }>("GET", `/v1/refs/projects/id/${projectId}/events?limit=${limit}`);
  return data.events ?? [];
}

export async function remoteSearch(opts: {
  query: string;
  limit?: number;
  roles?: ProjectRole[];
}): Promise<RetrievedChunk[]> {
  const data = await api<{ chunks: RetrievedChunk[] }>("POST", "/v1/refs/search", opts);
  return data.chunks ?? [];
}

export type RemoteIngestPayload = {
  slug: string;
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

export async function remoteCommitIngest(payload: RemoteIngestPayload): Promise<{
  status: "ok" | "skipped" | "error";
  fileCount: number;
  chunkCount: number;
  contentHash: string;
  error?: string;
}> {
  return api("POST", `/v1/refs/projects/${encodeURIComponent(payload.slug)}/ingest`, payload);
}
