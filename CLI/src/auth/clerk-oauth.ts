import {
  CLERK_FRONTEND_API,
  CLERK_OAUTH_CLIENT_ID,
} from "../config.ts";
import { pkceChallenge, randomString } from "./pkce.ts";
import type { StoredSession } from "./credentials.ts";

function requireClerkConfig() {
  if (!CLERK_OAUTH_CLIENT_ID || !CLERK_FRONTEND_API) {
    throw new Error(
      "Missing Clerk OAuth config. Set CLERK_OAUTH_CLIENT_ID and CLERK_FRONTEND_API in .env",
    );
  }
}

function issuer(): string {
  requireClerkConfig();
  return CLERK_FRONTEND_API!.replace(/\/$/, "");
}

export type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  token_type?: string;
};

export type UserInfo = {
  sub: string;
  email?: string;
  email_verified?: boolean;
  name?: string;
  given_name?: string;
  family_name?: string;
};

export function buildAuthorizeUrl(opts: {
  redirectUri: string;
  state: string;
  codeChallenge: string;
}): string {
  requireClerkConfig();
  const url = new URL(`${issuer()}/oauth/authorize`);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", CLERK_OAUTH_CLIENT_ID!);
  url.searchParams.set("redirect_uri", opts.redirectUri);
  url.searchParams.set("scope", "openid profile email offline_access");
  url.searchParams.set("state", opts.state);
  url.searchParams.set("code_challenge", opts.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

export async function exchangeCode(opts: {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}): Promise<TokenResponse> {
  requireClerkConfig();
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: CLERK_OAUTH_CLIENT_ID!,
    code: opts.code,
    redirect_uri: opts.redirectUri,
    code_verifier: opts.codeVerifier,
  });
  const res = await fetch(`${issuer()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Token exchange failed (${res.status}): ${text}`);
  return JSON.parse(text) as TokenResponse;
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  requireClerkConfig();
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: CLERK_OAUTH_CLIENT_ID!,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${issuer()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Refresh failed (${res.status}): ${text}`);
  return JSON.parse(text) as TokenResponse;
}

export async function fetchUserInfo(accessToken: string): Promise<UserInfo> {
  const res = await fetch(`${issuer()}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`userinfo failed (${res.status}): ${text}`);
  return JSON.parse(text) as UserInfo;
}

export function sessionFromTokens(tokens: TokenResponse, user: UserInfo): StoredSession {
  return {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    idToken: tokens.id_token,
    expiresAt: tokens.expires_in
      ? Date.now() + tokens.expires_in * 1000
      : undefined,
    userId: user.sub,
    email: user.email,
    firstName: user.given_name,
    lastName: user.family_name,
  };
}

export function newPkceLogin() {
  const codeVerifier = randomString(32);
  const state = randomString(16);
  return {
    codeVerifier,
    state,
    codeChallenge: pkceChallenge(codeVerifier),
  };
}
