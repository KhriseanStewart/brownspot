import { requireClerkConfig } from "../../config.ts";
import { runCliLogin } from "../../auth/login-flow.ts";

export async function cmdLogin() {
  requireClerkConfig();
  const session = await runCliLogin();
  console.log(`Logged in as ${session.email ?? session.userId}`);
}
