import {
  clearSession,
  isSessionValid,
  loadSession,
  saveSession,
  type StoredSession,
} from "./credentials.ts";
import { fetchUserInfo, refreshAccessToken, sessionFromTokens } from "./clerk-oauth.ts";
import { requireClerkConfig } from "../config.ts";
import { runCliLogin } from "./login-flow.ts";

export async function getValidSession(): Promise<StoredSession | null> {
  let session = loadSession();
  if (!session) return null;
  if (isSessionValid(session)) return session;

  if (session.refreshToken) {
    try {
      const tokens = await refreshAccessToken(session.refreshToken);
      const user = await fetchUserInfo(tokens.access_token);
      session = sessionFromTokens(tokens, user);
      saveSession(session);
      return session;
    } catch {
      clearSession();
      return null;
    }
  }
  clearSession();
  return null;
}

/** Require a real session; throw if missing (does not open browser). */
export async function requireAuthSession(): Promise<StoredSession> {
  const session = await getValidSession();
  if (!session) {
    throw new Error("Not logged in. Run: bun run login");
  }
  return session;
}

/**
 * Chat entry: if already logged in, return session;
 * otherwise open Clerk PKCE login, then return the new session.
 */
export async function ensureLoggedInForChat(): Promise<StoredSession> {
  const existing = await getValidSession();
  if (existing) return existing;

  console.log("Not logged in — opening browser to sign in with Clerk…");
  requireClerkConfig();
  return runCliLogin();
}

/** Auth is always required for the chat REPL. */
export function authIsRequired(): boolean {
  return true;
}
