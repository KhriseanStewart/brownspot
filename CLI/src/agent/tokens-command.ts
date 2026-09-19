import { snipGainReport, snipVersion, isSnipAvailable } from "./snip.ts";
import { style } from "./style.ts";

/** Handle /tokens … — show snip token savings. Returns true if consumed. */
export function handleTokensCommand(line: string): boolean {
  const trimmed = line.trim();
  if (
    !trimmed.startsWith("/tokens") &&
    !trimmed.startsWith("/snip") &&
    trimmed !== "tokens"
  ) {
    return false;
  }

  const rest = trimmed.replace(/^\/?(tokens|snip)\s*/, "").trim().toLowerCase();

  if (rest === "help") {
    console.log(`
${style.bold("/tokens")} — snip token savings (CLI Token Killer)
  /tokens           Weekly savings report
  /tokens daily     Daily report
  /tokens weekly    Weekly report
  /tokens monthly   Monthly report
  /tokens status    snip binary version / availability
  /snip             Alias for /tokens
`);
    return true;
  }

  if (rest === "status") {
    if (!isSnipAvailable()) {
      console.log(style.yellow("snip not found — run: bun run download-snip"));
    } else {
      console.log(style.dim(snipVersion() ?? "snip available"));
    }
    return true;
  }

  const period =
    rest === "daily" || rest === "day"
      ? ["--daily"]
      : rest === "monthly" || rest === "month"
        ? ["--monthly"]
        : ["--weekly"];

  console.log(snipGainReport(period));
  return true;
}
