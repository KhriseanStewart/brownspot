import {
  clearSession,
  isSessionValid,
  loadSession,
  saveSession,
  type StoredSession,
} from "./credentials.ts";
import { fetchUserInfo, refreshAccessToken, sessionFromTokens } from "./clerk-oauth.ts";
import { AUTH_REQUIRED, BROWNSPOT_DEV_BYPASS } from "../config.ts";

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

export async function requireAuthSession(): Promise<StoredSession> {
  if (BROWNSPOT_DEV_BYPASS) {
    return {
      accessToken: "dev-bypass",
      userId: "dev_bypass_user",
      email: "dev@localhost",
    };
  }
  const session = await getValidSession();
  if (!session) {
    throw new Error("Not logged in. Run: bun run login");
  }
  return session;
}

export function authIsRequired(): boolean {
  if (BROWNSPOT_DEV_BYPASS) return false;
  return AUTH_REQUIRED;
}
