import { describe, expect, test } from "bun:test";
import {
  isSnipAvailable,
  resolveSnipBin,
  runShellFiltered,
  snipGainReport,
  snipVersion,
  snipCandidates,
} from "../snip.ts";
import { handleTokensCommand } from "../tokens-command.ts";
import { tools } from "../tools.ts";

describe("snip integration", () => {
  test("1. snip binary resolves from resources or PATH", () => {
    const bin = resolveSnipBin();
    expect(bin).toBeTruthy();
    expect(isSnipAvailable()).toBe(true);
    expect(snipCandidates().length).toBeGreaterThan(0);
  });

  test("2. snip --version returns v*", () => {
    const v = snipVersion();
    expect(v).toBeTruthy();
    expect(v!).toMatch(/snip|v?\d+\.\d+/i);
  });

  test("3. runShellFiltered uses snip when available", () => {
    const r = runShellFiltered("echo brownspot-snip-ok");
    expect(r.usedSnip).toBe(true);
    expect(r.stdout).toContain("brownspot-snip-ok");
    expect(r.status).toBe(0);
  });

  test("4. runShellFiltered falls back when SNIP_DISABLED", () => {
    const prev = process.env.SNIP_DISABLED;
    process.env.SNIP_DISABLED = "1";
    try {
      const r = runShellFiltered("echo raw-fallback-ok");
      expect(r.usedSnip).toBe(false);
      expect(r.stdout).toContain("raw-fallback-ok");
    } finally {
      if (prev === undefined) delete process.env.SNIP_DISABLED;
      else process.env.SNIP_DISABLED = prev;
    }
  });

  test("5. /tokens command is registered and run_shell tool exists", () => {
    expect(tools.some((t) => t.type === "function" && t.function.name === "run_shell")).toBe(
      true,
    );
    // Should consume without throwing
    expect(handleTokensCommand("/tokens status")).toBe(true);
    expect(handleTokensCommand("/tokens help")).toBe(true);
    expect(handleTokensCommand("hello")).toBe(false);
  });

  test("6. snipGainReport returns a string (savings or empty-state)", () => {
    const report = snipGainReport(["--weekly"]);
    expect(typeof report).toBe("string");
    expect(report.length).toBeGreaterThan(0);
  });
});
