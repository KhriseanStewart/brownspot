import http from "node:http";
import { spawn } from "node:child_process";
import {
  buildAuthorizeUrl,
  exchangeCode,
  fetchUserInfo,
  newPkceLogin,
  sessionFromTokens,
} from "./clerk-oauth.ts";
import { saveSession, type StoredSession } from "./credentials.ts";
import { OAUTH_CALLBACK_PORT } from "../config.ts";
import { upsertUser, recordAuthEvent } from "../db/users.ts";

function openBrowser(url: string) {
  const cmd =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "start"
        : "xdg-open";
  spawn(cmd, [url], { detached: true, stdio: "ignore" }).unref();
}

/** Codex/Claude-style login: browser + PKCE + 127.0.0.1 callback. */
export async function runCliLogin(): Promise<StoredSession> {
  const { codeVerifier, state, codeChallenge } = newPkceLogin();

  const { code, redirectUri } = await new Promise<{
    code: string;
    redirectUri: string;
  }>((resolve, reject) => {
    const server = http.createServer((req, res) => {
      try {
        const u = new URL(req.url ?? "/", "http://127.0.0.1");
        if (u.pathname !== "/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }
        const err = u.searchParams.get("error");
        if (err) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(`<h1>Login failed</h1><p>${err}</p>`);
          server.close();
          reject(new Error(err));
          return;
        }
        const gotState = u.searchParams.get("state");
        const authCode = u.searchParams.get("code");
        if (!authCode || gotState !== state) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h1>Invalid login callback</h1>");
          server.close();
          reject(new Error("Invalid OAuth state or missing code"));
          return;
        }
        const addr = server.address();
        const port = addr && typeof addr !== "string" ? addr.port : 0;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(
          "<h1>BrownSpot login complete</h1><p>You can close this tab and return to the terminal.</p>",
        );
        server.close();
        resolve({ code: authCode, redirectUri });
      } catch (e) {
        server.close();
        reject(e);
      }
    });

    server.listen(OAUTH_CALLBACK_PORT, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to bind callback server"));
        return;
      }
      const redirectUri = `http://127.0.0.1:${addr.port}/callback`;
      const url = buildAuthorizeUrl({ redirectUri, state, codeChallenge });
      console.log("Opening browser for Clerk login…");
      openBrowser(url);
    });
    server.on("error", reject);
  });

  const tokens = await exchangeCode({ code, codeVerifier, redirectUri });
  const user = await fetchUserInfo(tokens.access_token);
  const session = sessionFromTokens(tokens, user);
  saveSession(session);

  try {
    await upsertUser({
      clerkUserId: session.userId,
      email: session.email,
      firstName: session.firstName,
      lastName: session.lastName,
    });
    await recordAuthEvent(session.userId, "login");
  } catch (e) {
    console.warn(
      "Logged in, but Postgres upsert failed:",
      e instanceof Error ? e.message : e,
    );
  }

  return session;
}
