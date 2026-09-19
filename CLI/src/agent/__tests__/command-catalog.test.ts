import { describe, expect, test } from "bun:test";
import { interpolateTemplate, shellQuote } from "../command-interpolate.ts";
import { tools } from "../tools.ts";

describe("command catalog interpolate", () => {
  test("shellQuote wraps and escapes single quotes", () => {
    expect(shellQuote("hi")).toBe("'hi'");
    expect(shellQuote("it's")).toBe("'it'\\''s'");
  });

  test("interpolates required params with quoting", () => {
    const cmd = interpolateTemplate("git commit -m {{message}}", {
      message: "fix typo",
    });
    expect(cmd).toBe("git commit -m 'fix typo'");
  });

  test("applies defaults and strips empty optional quoted args", () => {
    const cmd = interpolateTemplate(
      "git push {{remote}} {{branch}}",
      {},
      { remote: "origin", branch: "HEAD" },
    );
    expect(cmd).toBe("git push 'origin' 'HEAD'");
  });

  test("optional sections with {{#flag}}", () => {
    const on = interpolateTemplate("git diff{{#cached}} --cached{{/cached}}", {
      cached: "1",
    });
    const off = interpolateTemplate("git diff{{#cached}} --cached{{/cached}}", {});
    expect(on).toBe("git diff --cached");
    expect(off).toBe("git diff");
  });

  test("tools expose list_agent_commands and run_agent_command", () => {
    const names = tools
      .filter((t) => t.type === "function")
      .map((t) => t.function.name);
    expect(names).toContain("list_agent_commands");
    expect(names).toContain("run_agent_command");
    expect(names).toContain("run_shell");
  });
});
