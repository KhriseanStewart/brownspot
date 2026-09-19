import { getDb } from "./client.ts";

export type AppUser = {
  id: number;
  clerk_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
};

export async function upsertUser(input: {
  clerkUserId: string;
  email?: string | null;
  firstName?: string | null;
  lastName?: string | null;
}): Promise<AppUser> {
  const db = getDb();
  const rows = await db<AppUser[]>`
    INSERT INTO users (clerk_user_id, email, first_name, last_name)
    VALUES (${input.clerkUserId}, ${input.email ?? null}, ${input.firstName ?? null}, ${input.lastName ?? null})
    ON CONFLICT (clerk_user_id) DO UPDATE SET
      email = COALESCE(EXCLUDED.email, users.email),
      first_name = COALESCE(EXCLUDED.first_name, users.first_name),
      last_name = COALESCE(EXCLUDED.last_name, users.last_name),
      updated_at = NOW()
    RETURNING id, clerk_user_id, email, first_name, last_name
  `;
  return rows[0]!;
}

export async function recordAuthEvent(clerkUserId: string, event: string) {
  const db = getDb();
  await db`INSERT INTO auth_events (clerk_user_id, event) VALUES (${clerkUserId}, ${event})`;
}
