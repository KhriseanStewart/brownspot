/**
 * Personal memory: Mem0 Platform (free hosted) when MEM0_API_KEY is set,
 * otherwise Bun-native local SQLite under ~/.agent-cli/mem0/.
 *
 * Platform calls follow Mem0 docs:
 *   add(messages, { userId, agentId?, metadata })
 *   search(query, { filters: { user_id, agent_id? }, topK })
 */
import { MemoryClient } from "mem0ai";
import { Database } from "bun:sqlite";
import OpenAI from "openai";
import {
  AGENT_AGENT_ID,
  AGENT_ROLE,
  API_KEY,
  BASE_URL,
  MEM0_API_KEY,
  MEM0_EMBED_MODEL,
  MEM0_ENABLED,
  MEM0_LLM_MODEL,
  MEM0_SEARCH_LIMIT,
  getAgentUserId,
} from "../../config.ts";
import { ensureAgentDirs, mem0VectorDbPath } from "./paths.ts";

let platform: MemoryClient | null = null;
let db: Database | null = null;
let enabledOverride: boolean | null = null;
let openai: OpenAI | null = null;

export type MemoryBackend = "platform" | "local" | "off";

export function isMem0Enabled(): boolean {
  if (enabledOverride != null) return enabledOverride;
  return MEM0_ENABLED || Boolean(MEM0_API_KEY);
}

export function setMem0Enabled(on: boolean): void {
  enabledOverride = on;
  if (on) ensureReady();
}

export function memoryBackend(): MemoryBackend {
  if (!isMem0Enabled()) return "off";
  if (MEM0_API_KEY) return "platform";
  return "local";
}

/** Shared entity scope for Mem0 Platform (docs-compatible). */
export function memoryEntity() {
  return {
    userId: getAgentUserId(),
    ...(AGENT_AGENT_ID ? { agentId: AGENT_AGENT_ID } : {}),
  };
}

/** filters.user_id / filters.agent_id for search (snake_case per Mem0 docs). */
export function memorySearchFilters(): Record<string, string> {
  const filters: Record<string, string> = { user_id: getAgentUserId() };
  if (AGENT_AGENT_ID) filters.agent_id = AGENT_AGENT_ID;
  return filters;
}

function memoryMetadata(): Record<string, string> {
  return {
    role: AGENT_ROLE,
    source: "brownspot-cli",
  };
}

/** Instructions so Mem0 actually keeps lasting preferences (avoids empty NOOP adds). */
function preferenceInstructions(): string {
  const role = (AGENT_ROLE || AGENT_AGENT_ID || "").toLowerCase();
  const base =
    "Always extract and store lasting user preferences and identity facts. " +
    "Especially store: name, diet/allergies, package managers (Bun/npm/pnpm), languages, " +
    "frameworks, deploy targets, test commands, editor/IDE, and folder/layout conventions. " +
    "If the user says they prefer X over Y, or always use Z, that MUST become a memory. " +
    "Do not return empty / no-op when a clear preference is stated.";
  if (role.includes("develop") || role === "eng" || role === "engineer") {
    return (
      base +
      " This user is a software developer — prioritize stacks, tooling, and engineering conventions."
    );
  }
  return base;
}

function getOpenAI(): OpenAI {
  if (!openai) openai = new OpenAI({ apiKey: API_KEY!, baseURL: BASE_URL });
  return openai;
}

function getPlatform(): MemoryClient | null {
  if (!MEM0_API_KEY) return null;
  if (!platform) platform = new MemoryClient({ apiKey: MEM0_API_KEY });
  return platform;
}

function getDb(): Database | null {
  if (!API_KEY) return null;
  if (db) return db;
  ensureAgentDirs();
  db = new Database(mem0VectorDbPath());
  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      agent_id TEXT NOT NULL DEFAULT '',
      memory TEXT NOT NULL,
      embedding TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_memories_user ON memories(user_id, agent_id);
  `);
  return db;
}

export function ensureReady(): MemoryBackend {
  if (!isMem0Enabled()) return "off";
  if (MEM0_API_KEY) {
    getPlatform();
    return "platform";
  }
  getDb();
  return "local";
}

export function getMem0Client(): MemoryBackend {
  return ensureReady();
}

export type MemoryHit = { id?: string; memory: string; score?: number };

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i]! * b[i]!;
    na += a[i]! * a[i]!;
    nb += b[i]! * b[i]!;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

async function embed(text: string): Promise<number[]> {
  const res = await getOpenAI().embeddings.create({
    model: MEM0_EMBED_MODEL,
    input: text.slice(0, 8000),
  });
  return res.data[0]?.embedding ?? [];
}

async function extractFacts(
  messages: Array<{ role: string; content: string }>,
): Promise<string[]> {
  const transcript = messages
    .map((m) => `${m.role}: ${m.content}`)
    .join("\n")
    .slice(0, 6000);

  const developerHint = preferenceInstructions();
  const system =
    "Extract durable personal facts, preferences, and decisions from the conversation. " +
    "Return JSON only: {\"facts\":[\"...\"]}. Skip greetings, one-off questions, and secrets/API keys. " +
    "If nothing durable, return {\"facts\":[]}." +
    (developerHint ? `\n\n${developerHint}` : "");

  const res = await getOpenAI().chat.completions.create({
    model: MEM0_LLM_MODEL,
    temperature: 0,
    messages: [
      { role: "system", content: system },
      { role: "user", content: transcript },
    ],
  });

  const raw = res.choices[0]?.message?.content?.trim() ?? "";
  try {
    const start = raw.indexOf("{");
    const end = raw.lastIndexOf("}");
    const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw;
    const parsed = JSON.parse(json) as { facts?: unknown };
    if (!Array.isArray(parsed.facts)) return [];
    return parsed.facts
      .filter((f): f is string => typeof f === "string")
      .map((f) => f.trim())
      .filter(Boolean)
      .slice(0, 8);
  } catch {
    return [];
  }
}

async function searchPlatform(query: string): Promise<MemoryHit[]> {
  const client = getPlatform();
  if (!client) return [];
  // Docs: search(query, { filters: { user_id: "..." } })
  const res = await client.search(query, {
    filters: memorySearchFilters(),
    topK: MEM0_SEARCH_LIMIT,
  });
  const results = res.results ?? [];
  return results
    .map((r: { id?: string; memory?: string; score?: number }) => ({
      id: r.id,
      memory: String(r.memory ?? ""),
      score: r.score,
    }))
    .filter((h: MemoryHit) => h.memory.length > 0);
}

async function searchLocal(query: string): Promise<MemoryHit[]> {
  const database = getDb();
  if (!database || !query.trim()) return [];
  const qEmb = await embed(query);
  if (!qEmb.length) return [];

  const rows = database
    .query(
      `SELECT id, memory, embedding FROM memories WHERE user_id = ? AND agent_id = ?`,
    )
    .all(getAgentUserId(), AGENT_AGENT_ID) as Array<{
    id: string;
    memory: string;
    embedding: string;
  }>;

  return rows
    .map((r) => {
      let emb: number[] = [];
      try {
        emb = JSON.parse(r.embedding) as number[];
      } catch {
        emb = [];
      }
      return { id: r.id, memory: r.memory, score: cosine(qEmb, emb) };
    })
    .filter((h) => h.memory.length > 0)
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .slice(0, MEM0_SEARCH_LIMIT);
}

export async function searchMemories(query: string): Promise<MemoryHit[]> {
  if (!isMem0Enabled() || !query.trim()) return [];
  try {
    if (memoryBackend() === "platform") return await searchPlatform(query);
    return await searchLocal(query);
  } catch (err) {
    console.error(`[memory] search failed: ${err instanceof Error ? err.message : String(err)}`);
    return [];
  }
}

function countStored(addRes: unknown): number {
  if (!Array.isArray(addRes)) return 0;
  return addRes.filter((item) => {
    const event = String((item as { event?: string }).event ?? "").toUpperCase();
    // Treat explicit ADD/UPDATE as stored; NOOP/empty as not
    return event === "ADD" || event === "UPDATE" || Boolean((item as { memory?: string }).memory);
  }).length;
}

async function addPlatform(messages: Array<{ role: string; content: string }>): Promise<void> {
  const client = getPlatform();
  if (!client) return;
  const slice = messages
    .filter((m): m is { role: "user" | "assistant"; content: string } =>
      (m.role === "user" || m.role === "assistant") && Boolean(m.content.trim()),
    )
    .slice(-6)
    .map((m) => ({ role: m.role, content: m.content }));
  if (!slice.length) return;

  const entity = memoryEntity();
  const instructions = preferenceInstructions();
  const baseOpts = {
    userId: entity.userId,
    ...(entity.agentId ? { agentId: entity.agentId } : {}),
    user_id: entity.userId,
    ...(entity.agentId ? { agent_id: entity.agentId } : {}),
    metadata: memoryMetadata(),
    customInstructions: instructions,
    agentCustomInstructions: instructions,
    infer: true,
  };

  const addRes = await client.add(slice, baseOpts);
  let stored = countStored(addRes);

  // Mem0 often returns Succeeded with 0 memory changes (NOOP). Fall back to
  // explicit facts with infer:false so preferences like "I prefer Bun" stick.
  if (stored === 0) {
    const facts = await extractFacts(slice);
    for (const fact of facts) {
      // Single user message + infer:false → one memory row (avoids "Remembered: …" dupes)
      const explicit = await client.add([{ role: "user", content: fact }], {
        ...baseOpts,
        infer: false,
        metadata: { ...memoryMetadata(), explicit: "true" },
      });
      stored += Math.max(countStored(explicit), 1);
    }
    if (facts.length) {
      console.log(`(memory: Mem0 inferred nothing — stored ${facts.length} explicit fact(s))`);
    } else {
      console.log("(memory: nothing durable to store)");
    }
  } else {
    console.log(`(memory: stored ${stored} via Mem0)`);
  }
}

async function addLocal(messages: Array<{ role: string; content: string }>): Promise<void> {
  const database = getDb();
  if (!database) return;
  const facts = await extractFacts(messages);
  if (!facts.length) return;

  const existing = database
    .query(`SELECT memory FROM memories WHERE user_id = ? AND agent_id = ?`)
    .all(getAgentUserId(), AGENT_AGENT_ID) as Array<{ memory: string }>;
  const have = new Set(existing.map((e) => e.memory.toLowerCase()));
  const insert = database.query(
    `INSERT OR REPLACE INTO memories (id, user_id, agent_id, memory, embedding, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
  );

  for (const fact of facts) {
    if (have.has(fact.toLowerCase())) continue;
    const emb = await embed(fact);
    if (!emb.length) continue;
    insert.run(
      crypto.randomUUID(),
      getAgentUserId(),
      AGENT_AGENT_ID,
  getAgentUserId(),
      fact,
      JSON.stringify(emb),
      new Date().toISOString(),
    );
    have.add(fact.toLowerCase());
  }
}

export async function addMemoriesFromMessages(
  messages: Array<{ role: string; content: string }>,
): Promise<void> {
  if (!isMem0Enabled()) return;
  try {
    if (memoryBackend() === "platform") await addPlatform(messages);
    else await addLocal(messages);
  } catch (err) {
    console.error(`[memory] add failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

export function formatHitsForPrompt(hits: MemoryHit[]): string {
  if (!hits.length) return "";
  return hits.map((h, i) => `${i + 1}. ${h.memory}`).join("\n");
}
