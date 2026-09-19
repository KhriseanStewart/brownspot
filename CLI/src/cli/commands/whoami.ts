import { getValidSession } from "../../auth/session.ts";
import { BROWNSPOT_DEV_BYPASS } from "../../config.ts";

export async function cmdWhoami() {
  if (BROWNSPOT_DEV_BYPASS) {
    console.log("dev bypass user (BROWNSPOT_DEV_BYPASS=1)");
    return;
  }
  const session = await getValidSession();
  if (!session) {
    console.log("Not logged in. Run: bun run login");
    process.exitCode = 1;
    return;
  }
  console.log(`user:  ${session.userId}`);
  if (session.email) console.log(`email: ${session.email}`);
  if (session.firstName || session.lastName) {
    console.log(`name:  ${[session.firstName, session.lastName].filter(Boolean).join(" ")}`);
  }
}
