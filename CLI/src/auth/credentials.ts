import fs from "node:fs";
import { CREDENTIALS_PATH, ensureAuthDirs } from "./paths.ts";

export type StoredSession = {
  accessToken: string;
  refreshToken?: string;
  idToken?: string;
  expiresAt?: number; // epoch ms
  userId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

export function loadSession(): StoredSession | null {
  try {
    if (!fs.existsSync(CREDENTIALS_PATH)) return null;
    const raw = fs.readFileSync(CREDENTIALS_PATH, "utf8");
    return JSON.parse(raw) as StoredSession;
  } catch {
    return null;
  }
}

export function saveSession(session: StoredSession): void {
  ensureAuthDirs();
  fs.writeFileSync(CREDENTIALS_PATH, JSON.stringify(session, null, 2), { mode: 0o600 });
  try {
    fs.chmodSync(CREDENTIALS_PATH, 0o600);
  } catch {
    /* ignore */
  }
}

export function clearSession(): void {
  try {
    fs.unlinkSync(CREDENTIALS_PATH);
  } catch {
    /* ignore */
  }
}

export function isSessionValid(session: StoredSession | null): boolean {
  if (!session?.accessToken || !session.userId) return false;
  if (session.expiresAt && Date.now() > session.expiresAt - 30_000) return false;
  return true;
}
