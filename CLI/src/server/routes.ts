import { Hono } from "hono";
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
  return c.json({ ok: true, db: dbOk });
});

api.use("/me", requireAuth);
api.get("/me", (c) => {
  const user = c.get("authUser");
  return c.json({ user });
});

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
