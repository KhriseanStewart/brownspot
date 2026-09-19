import OpenAI from "openai";
import {
  API_KEY,
  BASE_URL,
  BROWNSPOT_API_URL,
  MODEL,
  useHostedLlm,
} from "../config.ts";
import { getValidSession } from "../auth/session.ts";

export type LlmMode = "local" | "hosted";

export async function resolveLlm(): Promise<{
  client: OpenAI;
  model: string;
  mode: LlmMode;
}> {
  if (!useHostedLlm()) {
    return {
      client: new OpenAI({ baseURL: BASE_URL, apiKey: API_KEY! }),
      model: MODEL,
      mode: "local",
    };
  }

  const session = await getValidSession();
  if (!session?.accessToken) {
    throw new Error("Not logged in. Run: dotstart login");
  }

  // OpenAI SDK talks to our API; Bearer is the Clerk access token.
  // Server swaps in your OpenRouter key from the deploy .env.
  return {
    client: new OpenAI({
      baseURL: `${BROWNSPOT_API_URL}/v1`,
      apiKey: session.accessToken,
    }),
    model: MODEL,
    mode: "hosted",
  };
}
