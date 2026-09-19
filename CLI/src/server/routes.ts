import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import OpenAI from "openai";
import { API_KEY, BASE_URL, MODEL } from "../config.ts";
import { requireAuth } from "./auth-middleware.ts";
import { getDb } from "../db/client.ts";

export const api = new Hono();

api.get("/health", async (c) => {
  let dbOk = false;
  try {
    const db = getDb();
    await db`SELECT 1`;
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return c.json({
    ok: true,
    db: dbOk,
    llm: Boolean(API_KEY && MODEL),
  });
});

api.use("/me", requireAuth);
api.get("/me", (c) => {
  const user = c.get("authUser");
  return c.json({ user });
});

/** Simple chat helper (optional). */
api.use("/v1/chat", requireAuth);
api.post("/v1/chat", async (c) => {
  if (!API_KEY || !MODEL) {
    return c.json({ error: "Server missing AGENT_API_KEY / AGENT_MODEL" }, 500);
  }
  const body = await c.req.json<{
    messages: Array<{ role: string; content: string }>;
  }>();
  const user = c.get("authUser");
  const client = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });
  const res = await client.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "system",
        content: `You are BrownSpot. Authenticated user: ${user.email ?? user.clerkUserId}. Be concise.`,
      },
      ...(body.messages as OpenAI.Chat.ChatCompletionMessageParam[]),
    ],
  });
  return c.json({
    userId: user.clerkUserId,
    message: res.choices[0]?.message ?? null,
  });
});

/**
 * OpenAI-compatible completions proxy.
 * CLI (hosted mode) posts here with Clerk access token as Bearer.
 * Server injects your OpenRouter key from deploy .env and forces MODEL.
 */
api.use("/v1/chat/completions", requireAuth);
api.post("/v1/chat/completions", async (c) => {
  if (!API_KEY || !MODEL) {
    return c.json({ error: "Server missing AGENT_API_KEY / AGENT_MODEL" }, 500);
  }

  const body = (await c.req.json()) as Record<string, unknown>;
  const upstream = new OpenAI({ apiKey: API_KEY, baseURL: BASE_URL });

  const messages = body.messages as OpenAI.Chat.ChatCompletionMessageParam[] | undefined;
  if (!messages?.length) {
    return c.json({ error: { message: "messages required" } }, 400);
  }

  try {
    const res = await upstream.chat.completions.create({
      messages,
      model: MODEL,
      tools: body.tools as OpenAI.Chat.ChatCompletionTool[] | undefined,
      tool_choice: body.tool_choice as OpenAI.Chat.ChatCompletionToolChoiceOption | undefined,
      temperature: typeof body.temperature === "number" ? body.temperature : undefined,
      max_tokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
      stream: false,
    });
    return c.json(res);
  } catch (e) {
    const err = e as { status?: number; message?: string };
    const raw = typeof err.status === "number" ? err.status : 502;
    const status = (raw >= 400 && raw < 600 ? raw : 502) as ContentfulStatusCode;
    return c.json(
      {
        error: {
          message: err.message ?? "Upstream LLM request failed",
          type: "brownspot_proxy_error",
        },
      },
      status,
    );
  }
});
