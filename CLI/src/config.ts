import path from "node:path";
import os from "node:os";
import { PRODUCT } from "./product.ts";

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function boolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  return !["0", "false", "no", "off"].includes(raw.toLowerCase());
}

/** Treat missing or blank env as unset (Bun/.env often sets ""). */
function envOr(name: string, fallback: string): string {
  const raw = process.env[name];
  if (raw == null) return fallback;
  const v = raw.trim();
  return v.length > 0 ? v : fallback;
}

export const WORKSPACE = path.resolve(process.env.AGENT_WORKSPACE ?? process.cwd());
export const MODEL = envOr("AGENT_MODEL", PRODUCT.defaultModel);
export const API_KEY = process.env.AGENT_API_KEY;
export const BASE_URL = process.env.AGENT_BASE_URL ?? "https://openrouter.ai/api/v1";
export const MAX_STEPS = intEnv("AGENT_MAX_STEPS", 20);

export const CONTEXT_MAX_TOKENS = intEnv("AGENT_CONTEXT_MAX_TOKENS", 24_000);
export const CONTEXT_KEEP_RECENT = intEnv("AGENT_CONTEXT_KEEP_RECENT", 6);
export const CONTEXT_SUMMARIZE = boolEnv("AGENT_CONTEXT_SUMMARIZE", true);
export const SUMMARY_MODEL =
  process.env.AGENT_SUMMARY_MODEL ?? "google/gemini-3.8-flash";
export const TOOL_RESULT_MAX_CHARS = intEnv("AGENT_TOOL_RESULT_MAX_CHARS", 6_000);

export const MEM0_ENABLED = boolEnv("AGENT_MEM0", false);
export const MEM0_API_KEY = process.env.MEM0_API_KEY;
export function getAgentUserId(): string {
  return (
    process.env.AGENT_USER_ID ??
    process.env.USER ??
    os.userInfo().username ??
    "default"
  );
}
export const AGENT_USER_ID = getAgentUserId();
export const AGENT_AGENT_ID = process.env.AGENT_AGENT_ID ?? process.env.AGENT_ROLE ?? "";
export const AGENT_ROLE =
  process.env.AGENT_ROLE ?? process.env.AGENT_AGENT_ID ?? "general";
export const MEM0_LLM_MODEL =
  process.env.MEM0_LLM_MODEL ?? "google/gemini-3.8-flash";
export const MEM0_EMBED_MODEL =
  process.env.MEM0_EMBED_MODEL ?? "openai/text-embedding-3-small";
export const MEM0_SEARCH_LIMIT = intEnv("AGENT_MEM0_SEARCH_LIMIT", 5);

/** Local Homebrew Postgres (no Docker). */
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://localhost/brownspot";

/**
 * Public Clerk defaults (safe to ship in the binary).
 * Override with env for local/dev. Never put AGENT_API_KEY defaults here.
 */
export const CLERK_OAUTH_CLIENT_ID = envOr(
  "CLERK_OAUTH_CLIENT_ID",
  PRODUCT.clerkOAuthClientId,
);
/** Production Frontend API (custom domain). */
export const CLERK_FRONTEND_API = envOr(
  "CLERK_FRONTEND_API",
  PRODUCT.clerkFrontendApi,
);
export const CLERK_SECRET_KEY = process.env.CLERK_SECRET_KEY;

/** Require login for chat (Codex/Claude style). */
export const AUTH_REQUIRED = boolEnv("BROWNSPOT_AUTH_REQUIRED", true);
/** Local-only escape hatch for development. */
export const BROWNSPOT_DEV_BYPASS = boolEnv("BROWNSPOT_DEV_BYPASS", false);

export const API_HOST = process.env.BROWNSPOT_API_HOST ?? "127.0.0.1";
export const API_PORT = intEnv("BROWNSPOT_API_PORT", 8787);
/** Fixed local port for Clerk PKCE callback (register exactly in Clerk). */
export const OAUTH_CALLBACK_PORT = intEnv("BROWNSPOT_OAUTH_CALLBACK_PORT", PRODUCT.oauthCallbackPort);

/**
 * Hosted BrownSpot API — after Clerk login, the CLI calls this with the
 * user access token. The server holds AGENT_API_KEY from your deploy .env.
 */
export const BROWNSPOT_API_URL = envOr(
  "BROWNSPOT_API_URL",
  PRODUCT.apiUrl,
).replace(/\/$/, "");

/** True when this machine has a local OpenRouter key (dev / power users). */
export function hasLocalLlmKey(): boolean {
  return Boolean(API_KEY && API_KEY.trim());
}

/** Prefer hosted API for end users (no local key). */
export function useHostedLlm(): boolean {
  return !hasLocalLlmKey();
}


/** Reference / active project RAG */
export const BROWNSPOT_MAX_REFS = intEnv("BROWNSPOT_MAX_REFS", 3);
/** Optional embeddings — OFF by default (FTS is free/cheap). */
export const BROWNSPOT_REF_EMBEDDINGS = boolEnv("BROWNSPOT_REF_EMBEDDINGS", false);
/** Cheapest OpenRouter embedding model when embeddings are enabled. */
export const REF_EMBED_MODEL =
  process.env.BROWNSPOT_REF_EMBED_MODEL ?? "openai/text-embedding-3-small";
export const REF_CONTEXT_BUDGET = intEnv("BROWNSPOT_REF_CONTEXT_BUDGET", 3800);
export const REF_SEARCH_LIMIT = intEnv("BROWNSPOT_REF_SEARCH_LIMIT", 8);
export const REF_MAX_DEPTH = intEnv("BROWNSPOT_REF_MAX_DEPTH", 6);
export const REF_MAX_FILES = intEnv("BROWNSPOT_REF_MAX_FILES", 800);
export const REF_MAX_FILE_BYTES = intEnv("BROWNSPOT_REF_MAX_FILE_BYTES", 120_000);

export function requireConfig(): void {
  // Hosted mode: Clerk login + BROWNSPOT_API_URL — no local AGENT_API_KEY.
  if (useHostedLlm()) {
    if (!CLERK_OAUTH_CLIENT_ID || !CLERK_FRONTEND_API) {
      console.error("Missing Clerk public config.");
      process.exit(1);
    }
    return;
  }
  if (!MODEL || !API_KEY) {
    console.error(
      "Set AGENT_MODEL and AGENT_API_KEY in .env, or omit them to use the hosted BrownSpot API after login.",
    );
    process.exit(1);
  }
}

export function requireClerkConfig(): void {
  if (!CLERK_OAUTH_CLIENT_ID || !CLERK_FRONTEND_API) {
    console.error(
      "Set CLERK_OAUTH_CLIENT_ID and CLERK_FRONTEND_API in .env (see README Auth section).",
    );
    process.exit(1);
  }
}

export function requireServerLlmConfig(): void {
  if (!MODEL || !API_KEY) {
    console.error("Server requires AGENT_MODEL and AGENT_API_KEY in the deploy environment.");
    process.exit(1);
  }
}
