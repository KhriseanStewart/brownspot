import { getValidSession } from "../../auth/session.ts";
import { style } from "../../agent/style.ts";

export async function cmdWhoami() {
  const session = await getValidSession();
  if (!session) {
    console.log(style.yellow("Not logged in. Run: bun run login  (or bun run dev)"));
    process.exitCode = 1;
    return;
  }
  printWhoami(session);
}

export function printWhoami(session: {
  userId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
}) {
  console.log(`user:  ${session.userId}`);
  if (session.email) console.log(`email: ${session.email}`);
  if (session.firstName || session.lastName) {
    console.log(
      `name:  ${[session.firstName, session.lastName].filter(Boolean).join(" ")}`,
    );
  }
}
