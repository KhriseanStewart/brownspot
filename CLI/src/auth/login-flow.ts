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
  if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    return;
  }
  if (process.platform === "win32") {
    // `start` is a cmd builtin; empty title arg is required when the URL has special chars.
    spawn("cmd", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true,
    }).unref();
    return;
  }
  spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
}

/** Prefer Cursor/VS Code, then the terminal that launched us. */
function detectFocusApp(): string {
  const term = (process.env.TERM_PROGRAM ?? "").toLowerCase();
  const envBlob = [
    process.env.TERM_PROGRAM,
    process.env.TERM_PROGRAM_VERSION,
    process.env.CURSOR_TRACE_ID,
    process.env.VSCODE_INJECTION,
    process.env.VSCODE_PID,
    process.env.VSCODE_GIT_IPC_HANDLE,
    process.env.__CFBundleIdentifier,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    envBlob.includes("cursor") ||
    term === "cursor" ||
    process.env.CURSOR_TRACE_ID ||
    // Cursor's integrated terminal still reports TERM_PROGRAM=vscode
    (term === "vscode" && (process.env.CURSOR_TRACE_ID || process.env.VSCODE_GIT_IPC_HANDLE))
  ) {
    // Prefer Cursor app name when present
    return "Cursor";
  }
  if (term === "vscode" || process.env.VSCODE_INJECTION || process.env.VSCODE_PID) {
    // Could be Cursor (reports as vscode) — try Cursor first via open later
    return "Cursor";
  }
  if (term.includes("iterm")) return "iTerm";
  if (term.includes("warp")) return "Warp";
  if (term === "apple_terminal") return "Terminal";
  return "Cursor";
}

/** Bring Cursor (or the terminal) back to the front after browser OAuth. */
function refocusIde() {
  if (process.platform === "darwin") {
    const app = detectFocusApp();
    // `open -a` is the most reliable way to foreground the IDE on macOS.
    spawn("open", ["-a", app], { detached: true, stdio: "ignore" }).unref();
    // Also AppleScript activate as a backup (helps when open is a no-op).
    spawn(
      "osascript",
      ["-e", `tell application "${app}" to activate`],
      { detached: true, stdio: "ignore" },
    ).unref();
    return;
  }
  if (process.platform === "win32") {
    // Best-effort: foreground Cursor, then VS Code via custom URL schemes.
    for (const scheme of ["cursor://", "vscode://"]) {
      spawn("cmd", ["/c", "start", "", scheme], {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      }).unref();
    }
  }
}

const SUCCESS_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>BrownSpot login complete</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 28rem; margin: 4rem auto; padding: 0 1rem; color: #111; }
    h1 { font-size: 1.35rem; }
    p { color: #444; line-height: 1.5; }
    a { color: #2563eb; }
  </style>
</head>
<body>
  <h1>BrownSpot login complete</h1>
  <p>Sending you back to Cursor…</p>
  <p id="hint" hidden>If nothing happens, <a id="back" href="cursor://">click here to return to Cursor</a>, then close this tab.</p>
  <script>
    (function () {
      var triedClose = false;
      function goIde() {
        // Custom URL schemes foreground the IDE when registered.
        try { window.location.href = "cursor://"; } catch (e) {}
        setTimeout(function () {
          try { window.location.href = "vscode://"; } catch (e) {}
        }, 200);
      }
      function tryClose() {
        if (triedClose) return;
        triedClose = true;
        try { window.close(); } catch (e) {}
        // Most browsers block close() on OAuth redirects — show fallback.
        setTimeout(function () {
          var hint = document.getElementById("hint");
          if (hint) hint.hidden = false;
        }, 400);
      }
      goIde();
      setTimeout(tryClose, 350);
    })();
  </script>
</body>
</html>`;

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
        const port = addr && typeof addr !== "string" ? addr.port : OAUTH_CALLBACK_PORT;
        const redirectUri = `http://127.0.0.1:${port}/callback`;
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(SUCCESS_HTML);
        server.close();
        // Foreground Cursor immediately (don't wait for token exchange).
        refocusIde();
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

  refocusIde();
  return session;
}
