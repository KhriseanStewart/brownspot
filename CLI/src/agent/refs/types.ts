export type ProjectRole = "reference" | "active";

export type ProjectEventType =
  | "added"
  | "ingested"
  | "reindexed"
  | "removed"
  | "activated";

export type ChunkKind =
  | "profile"
  | "readme"
  | "pkg"
  | "config"
  | "doc"
  | "file";

export type ReferenceProject = {
  id: number;
  clerk_user_id: string;
  slug: string;
  label: string;
  local_path: string;
  project_role: ProjectRole;
  enabled: boolean;
  is_primary: boolean;
  sort_order: number;
  last_ingest_at: Date | string | null;
  last_content_hash: string | null;
  metadata: Record<string, unknown>;
  created_at: Date | string;
  updated_at: Date | string;
};

export type ProjectChunk = {
  id: number;
  project_id: number;
  snapshot_id: number | null;
  kind: ChunkKind;
  path: string;
  title: string | null;
  content: string;
  content_hash: string;
  metadata: Record<string, unknown>;
};

export type RetrievedChunk = ProjectChunk & {
  slug: string;
  project_role: ProjectRole;
  label: string;
  rank?: number;
};

export type RefsCacheFile = {
  version: 1;
  clerkUserId: string;
  projects: Array<{
    slug: string;
    label: string;
    local_path: string;
    project_role: ProjectRole;
    enabled: boolean;
    is_primary: boolean;
    sort_order: number;
  }>;
  updatedAt: string;
};
