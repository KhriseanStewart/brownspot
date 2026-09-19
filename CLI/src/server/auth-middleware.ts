import type { Context, Next } from "hono";
import { CLERK_FRONTEND_API, CLERK_SECRET_KEY, BROWNSPOT_DEV_BYPASS } from "../config.ts";
import { upsertUser } from "../db/users.ts";

export type AuthUser = {
  clerkUserId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
};

declare module "hono" {
  interface ContextVariableMap {
    authUser: AuthUser;
  }
}

async function verifyWithClerkSecret(token: string): Promise<AuthUser | null> {
  if (!CLERK_SECRET_KEY || !CLERK_FRONTEND_API) return null;
  // Prefer OAuth userinfo (works with access tokens from PKCE login)
  const issuer = CLERK_FRONTEND_API.replace(/\/$/, "");
  const res = await fetch(`${issuer}/oauth/userinfo`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const info = (await res.json()) as {
    sub: string;
    email?: string;
    given_name?: string;
    family_name?: string;
  };
  if (!info.sub) return null;
  return {
    clerkUserId: info.sub,
    email: info.email,
    firstName: info.given_name,
    lastName: info.family_name,
  };
}

export async function requireAuth(c: Context, next: Next) {
  if (BROWNSPOT_DEV_BYPASS) {
    c.set("authUser", {
      clerkUserId: "dev_bypass_user",
      email: "dev@localhost",
    });
    await next();
    return;
  }

  const header = c.req.header("authorization") ?? "";
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) return c.json({ error: "Unauthorized" }, 401);

  const user = await verifyWithClerkSecret(match[1]!);
  if (!user) return c.json({ error: "Invalid or expired token" }, 401);

  try {
    await upsertUser({
      clerkUserId: user.clerkUserId,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
  } catch {
    /* DB optional for health; chat still needs auth */
  }

  c.set("authUser", user);
  await next();
}
