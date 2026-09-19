/**
 * Optional embeddings path — OFF by default (BROWNSPOT_REF_EMBEDDINGS=false).
 * When on: embed only high-value chunks; store as REAL[]; cosine in app.
 */
import OpenAI from "openai";
import {
  API_KEY,
  BASE_URL,
  BROWNSPOT_REF_EMBEDDINGS,
  REF_EMBED_MODEL,
} from "../../config.ts";
import { getDb } from "../../db/client.ts";
import type { ChunkKind } from "./types.ts";

const HIGH_VALUE: Set<ChunkKind> = new Set([
  "profile",
  "readme",
  "pkg",
  "config",
  "doc",
]);

export function embeddingsEnabled(): boolean {
  return BROWNSPOT_REF_EMBEDDINGS && Boolean(API_KEY?.trim());
}

export function isHighValueKind(kind: ChunkKind): boolean {
  return HIGH_VALUE.has(kind);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom === 0 ? 0 : dot / denom;
}

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!API_KEY) throw new Error("AGENT_API_KEY required for embeddings");
  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
  const res = await client.embeddings.create({
    model: REF_EMBED_MODEL,
    input: texts,
  });
  return res.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding as number[]);
}

export async function embedChunkIfEnabled(
  chunkId: number,
  kind: ChunkKind,
  text: string,
): Promise<void> {
  if (!embeddingsEnabled()) return;
  if (!isHighValueKind(kind)) return;
  const trimmed = text.slice(0, 6000);
  if (!trimmed.trim()) return;

  try {
    const [vec] = await embedTexts([trimmed]);
    if (!vec?.length) return;
    const db = getDb();
    await db`
      INSERT INTO project_embeddings (chunk_id, model, dims, embedding)
      VALUES (${chunkId}, ${REF_EMBED_MODEL}, ${vec.length}, ${vec})
      ON CONFLICT (chunk_id, model) DO UPDATE SET
        dims = EXCLUDED.dims,
        embedding = EXCLUDED.embedding
    `;
  } catch {
    /* best-effort; FTS remains primary */
  }
}
