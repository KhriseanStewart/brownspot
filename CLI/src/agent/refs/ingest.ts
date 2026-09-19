import fs from "node:fs/promises";
import path from "node:path";
import OpenAI from "openai";
import {
  API_KEY,
  BASE_URL,
  REF_MAX_DEPTH,
  REF_MAX_FILE_BYTES,
  REF_MAX_FILES,
} from "../../config.ts";
import { getDb } from "../../db/client.ts";
import { cheapModelId } from "../model-prefs.ts";
import { addMemoriesFromMessages, isMem0Enabled } from "../memory/mem0.ts";
import { contentHash, combineHashes } from "./hash.ts";
import {
  assertSafeProjectPath,
  isLikelyBinaryPath,
  shouldSkipName,
} from "./ignore.ts";
import { embedChunkIfEnabled } from "./embed.ts";
import {
  getProjectBySlug,
  recordEvent,
  updateIngestMeta,
} from "./store.ts";
import type { ChunkKind, ReferenceProject } from "./types.ts";

type FileChunk = {
  kind: ChunkKind;
  path: string;
  title: string;
  content: string;
  contentHash: string;
  highValue: boolean;
};

function classifyPath(rel: string): { kind: ChunkKind; highValue: boolean } {
  const base = path.basename(rel).toLowerCase();
  const lower = rel.toLowerCase();
  if (base === "readme.md" || base === "readme") {
    return { kind: "readme", highValue: true };
  }
  if (
    base === "package.json" ||
    base === "pyproject.toml" ||
    base === "cargo.toml" ||
    base === "go.mod" ||
    base === "composer.json"
  ) {
    return { kind: "pkg", highValue: true };
  }
  if (
    /\.(json|ya?ml|toml|ini)$/i.test(base) ||
    base.startsWith("tsconfig") ||
    base.startsWith("eslint") ||
    base === "dockerfile" ||
    base.startsWith("docker-compose")
  ) {
    return { kind: "config", highValue: true };
  }
  if (
    lower.includes("/docs/") ||
    lower.startsWith("docs/") ||
    /\.(md|rst|adoc)$/i.test(base)
  ) {
    return { kind: "doc", highValue: true };
  }
  return { kind: "file", highValue: false };
}

async function walkProject(
  root: string,
): Promise<{ chunks: FileChunk[]; treeHash: string; fileCount: number }> {
  const chunks: FileChunk[] = [];
  const hashParts: string[] = [];
  let fileCount = 0;

  async function walk(dir: string, depth: number): Promise<void> {
    if (depth > REF_MAX_DEPTH) return;
    if (fileCount >= REF_MAX_FILES) return;
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const ent of entries) {
      if (fileCount >= REF_MAX_FILES) break;
      if (shouldSkipName(ent.name)) continue;
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        await walk(abs, depth + 1);
        continue;
      }
      if (!ent.isFile()) continue;
      if (isLikelyBinaryPath(abs)) continue;

      let st;
      try {
        st = await fs.stat(abs);
      } catch {
        continue;
      }
      if (st.size > REF_MAX_FILE_BYTES) continue;
      if (st.size === 0) continue;

      let text: string;
      try {
        text = await fs.readFile(abs, "utf8");
      } catch {
        continue;
      }
      // Skip null-heavy binaries mislabeled as text
      if (text.includes("\u0000")) continue;

      fileCount++;
      const rel = path.relative(root, abs).split(path.sep).join("/");
      const { kind, highValue } = classifyPath(rel);
      const hash = contentHash(text);
      hashParts.push(`${rel}:${hash}`);

      // Prefer high-value; also keep a thin sample of other source files
      const keep =
        highValue ||
        /\.(ts|tsx|js|jsx|py|rs|go|java|kt|swift|rb|php|cs)$/i.test(rel);
      if (!keep) continue;

      const maxContent = highValue ? 8000 : 2500;
      const content =
        text.length > maxContent ? text.slice(0, maxContent) + "\n…" : text;
      chunks.push({
        kind,
        path: rel,
        title: rel,
        content,
        contentHash: hash,
        highValue,
      });
    }
  }

  await walk(root, 0);
  return { chunks, treeHash: combineHashes(hashParts), fileCount };
}

async function distillProfile(
  project: ReferenceProject,
  chunks: FileChunk[],
): Promise<{ summaryMd: string; styleJson: Record<string, unknown> } | null> {
  if (!API_KEY?.trim()) return null;
  const sample = chunks
    .filter((c) => c.highValue)
    .slice(0, 12)
    .map((c) => `### ${c.path}\n${c.content.slice(0, 1200)}`)
    .join("\n\n")
    .slice(0, 12_000);
  if (!sample.trim()) return null;

  try {
    const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
    const model = cheapModelId();
    const res = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        {
          role: "system",
          content:
            "You distill a coding profile from project snippets. Reply with JSON only: " +
            '{"summary_md":"markdown summary","style":{"languages":[],"package_manager":"","frameworks":[],"conventions":[],"test_command":""}}',
        },
        {
          role: "user",
          content: `Project slug: ${project.slug}\nPath: ${project.local_path}\nRole: ${project.project_role}\n\n${sample}`,
        },
      ],
    });
    const raw = res.choices[0]?.message?.content?.trim() ?? "";
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return null;
    const parsed = JSON.parse(jsonMatch[0]) as {
      summary_md?: string;
      style?: Record<string, unknown>;
    };
    return {
      summaryMd: parsed.summary_md ?? "",
      styleJson: parsed.style ?? {},
    };
  } catch {
    return null;
  }
}

export type IngestResult = {
  status: "ok" | "skipped" | "error";
  fileCount: number;
  chunkCount: number;
  contentHash: string;
  error?: string;
};

export async function ingestProject(
  project: ReferenceProject,
  opts?: { force?: boolean },
): Promise<IngestResult> {
  const db = getDb();
  let root: string;
  try {
    root = assertSafeProjectPath(project.local_path);
    await fs.access(root);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const snap = await db<{ id: number }[]>`
      INSERT INTO project_snapshots (project_id, status, error)
      VALUES (${project.id}, 'error', ${msg})
      RETURNING id
    `;
    await recordEvent(project.id, "ingested", {
      snapshotId: snap[0]?.id,
      metadata: { status: "error", error: msg },
    });
    return { status: "error", fileCount: 0, chunkCount: 0, contentHash: "", error: msg };
  }

  const { chunks, treeHash, fileCount } = await walkProject(root);

  if (
    !opts?.force &&
    project.last_content_hash &&
    project.last_content_hash === treeHash
  ) {
    const snap = await db<{ id: number }[]>`
      INSERT INTO project_snapshots (project_id, status, file_count, chunk_count)
      VALUES (${project.id}, 'skipped', ${fileCount}, 0)
      RETURNING id
    `;
    await recordEvent(project.id, "ingested", {
      snapshotId: snap[0]?.id,
      metadata: { status: "skipped", reason: "unchanged" },
    });
    return { status: "skipped", fileCount, chunkCount: 0, contentHash: treeHash };
  }

  const snapRows = await db<{ id: number }[]>`
    INSERT INTO project_snapshots (project_id, status, file_count)
    VALUES (${project.id}, 'running', ${fileCount})
    RETURNING id
  `;
  const snapshotId = snapRows[0]!.id;

  try {
    await db`DELETE FROM project_chunks WHERE project_id = ${project.id}`;

    const profile = await distillProfile(project, chunks);
    if (profile) {
      await db`
        INSERT INTO project_profiles (project_id, summary_md, style_json, updated_at)
        VALUES (${project.id}, ${profile.summaryMd}, ${db.json(profile.styleJson as never)}, NOW())
        ON CONFLICT (project_id) DO UPDATE SET
          summary_md = EXCLUDED.summary_md,
          style_json = EXCLUDED.style_json,
          updated_at = NOW()
      `;
      const profileHash = contentHash(profile.summaryMd);
      const profileRows = await db<{ id: number }[]>`
        INSERT INTO project_chunks (
          project_id, snapshot_id, kind, path, title, content, content_hash, metadata
        ) VALUES (
          ${project.id}, ${snapshotId}, 'profile', '', 'Coding profile',
          ${profile.summaryMd}, ${profileHash},
          ${db.json({ style: profile.styleJson } as never)}
        )
        RETURNING id
      `;
      const pid = profileRows[0]?.id;
      if (pid) {
        await embedChunkIfEnabled(pid, "profile", profile.summaryMd);
      }

      if (isMem0Enabled() && profile.summaryMd.trim()) {
        void addMemoriesFromMessages([
          {
            role: "user",
            content: `Coding profile for project ${project.slug} (${project.project_role}): ${profile.summaryMd}`,
          },
        ]);
      }
    }

    let chunkCount = profile ? 1 : 0;
    for (const c of chunks) {
      const rows = await db<{ id: number }[]>`
        INSERT INTO project_chunks (
          project_id, snapshot_id, kind, path, title, content, content_hash, metadata
        ) VALUES (
          ${project.id}, ${snapshotId}, ${c.kind}, ${c.path}, ${c.title},
          ${c.content}, ${c.contentHash},
          ${db.json({ high_value: c.highValue } as never)}
        )
        RETURNING id
      `;
      chunkCount++;
      const id = rows[0]?.id;
      if (id && c.highValue) {
        await embedChunkIfEnabled(id, c.kind, c.content);
      }
    }

    await db`
      UPDATE project_snapshots
      SET status = 'ok', chunk_count = ${chunkCount}
      WHERE id = ${snapshotId}
    `;
    await updateIngestMeta(project.id, treeHash);
    await recordEvent(project.id, opts?.force ? "reindexed" : "ingested", {
      snapshotId,
      metadata: { status: "ok", fileCount, chunkCount },
    });

    return { status: "ok", fileCount, chunkCount, contentHash: treeHash };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await db`
      UPDATE project_snapshots
      SET status = 'error', error = ${msg}
      WHERE id = ${snapshotId}
    `;
    await recordEvent(project.id, "ingested", {
      snapshotId,
      metadata: { status: "error", error: msg },
    });
    return {
      status: "error",
      fileCount,
      chunkCount: 0,
      contentHash: treeHash,
      error: msg,
    };
  }
}

export async function ingestBySlug(
  clerkUserId: string,
  slug: string,
  opts?: { force?: boolean },
): Promise<IngestResult> {
  const project = await getProjectBySlug(clerkUserId, slug);
  if (!project) {
    return {
      status: "error",
      fileCount: 0,
      chunkCount: 0,
      contentHash: "",
      error: `Unknown slug: ${slug}`,
    };
  }
  return ingestProject(project, opts);
}
