import { describe, expect, test } from "bun:test";
import { diffStats, formatUnifiedDiff } from "../diff.ts";

describe("unified diff", () => {
  test("stats count added and removed lines", () => {
    const before = "a\nb\nc\n";
    const after = "a\nB\nc\nd\n";
    const s = diffStats(before, after);
    expect(s.removed).toBe(1);
    expect(s.added).toBe(2);
    expect(s.summary).toContain("+2");
  });

  test("format includes hunk headers and markers", () => {
    const d = formatUnifiedDiff("foo.ts", "hello\nworld\n", "hello\nthere\n");
    expect(d).toContain("--- a/foo.ts");
    expect(d).toContain("+++ b/foo.ts");
    expect(d).toContain("-world");
    expect(d).toContain("+there");
    expect(d).toContain("@@");
  });

  test("new file is all additions", () => {
    const d = formatUnifiedDiff("new.ts", "", "one\ntwo\n");
    expect(d).toContain("+one");
    expect(d).toContain("+two");
    expect(diffStats("", "one\ntwo\n").added).toBe(2);
  });
});
