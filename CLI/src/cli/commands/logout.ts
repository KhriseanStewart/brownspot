import { clearSession, loadSession } from "../../auth/credentials.ts";
import { recordAuthEvent } from "../../db/users.ts";

export async function cmdLogout() {
  const session = loadSession();
  if (session) {
    try {
      await recordAuthEvent(session.userId, "logout");
    } catch {
      /* ignore */
    }
  }
  clearSession();
  console.log("Logged out.");
}
