import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { style } from "../../agent/style.ts";

const REPO = "KhriseanStewart/brownspot";
const RAW_BASE = `https://raw.githubusercontent.com/${REPO}/main/scripts`;

function run(cmd: string, args: string[], env?: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: "inherit",
      env: { ...process.env, ...env },
      shell: process.platform === "win32",
    });
    child.on("error", reject);
    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function downloadText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": "BrownSpot-dotstart-update" },
  });
  if (!res.ok) throw new Error(`Failed to download ${url} (${res.status})`);
  return res.text();
}

/** Re-run the public installer to update BrownSpot (dotstart). */
export async function cmdUpdate() {
  const version = process.env.BROWNSPOT_VERSION; // optional pin
  console.log(style.dim("Updating BrownSpot (dotstart)…"));

  if (process.platform === "win32") {
    const ps1 = await downloadText(`${RAW_BASE}/install.ps1`);
    const tmp = path.join(os.tmpdir(), `brownspot-install-${Date.now()}.ps1`);
    fs.writeFileSync(tmp, ps1, "utf8");
    const env: NodeJS.ProcessEnv = {};
    if (version) env.BROWNSPOT_VERSION = version.replace(/^v/, "");
    const code = await run(
      "powershell",
      ["-ExecutionPolicy", "Bypass", "-File", tmp],
      env,
    );
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    if (code !== 0) process.exit(code);
    console.log(style.green("BrownSpot updated. Run: dotstart"));
    return;
  }

  const sh = await downloadText(`${RAW_BASE}/install.sh`);
  const tmp = path.join(os.tmpdir(), `brownspot-install-${Date.now()}.sh`);
  fs.writeFileSync(tmp, sh, { mode: 0o755 });
  const env: NodeJS.ProcessEnv = {};
  if (version) env.BROWNSPOT_VERSION = version.replace(/^v/, "");
  const code = await run("bash", [tmp], env);
  try {
    fs.unlinkSync(tmp);
  } catch {
    /* ignore */
  }
  if (code !== 0) process.exit(code);
  console.log(style.green("BrownSpot updated. Run: dotstart"));
}
