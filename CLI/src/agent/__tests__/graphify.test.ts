import { describe, expect, test } from "bun:test";
import { tools } from "../tools.ts";
import { noteFileRead, readGuardHint, wasRecentlyRead } from "../graphify/read-guard.ts";
import { isGraphifyEnabled } from "../graphify/ensure.ts";

describe("graphify CLI integration", () => {
  test("graph tools are registered", () => {
    const names = tools
      .filter((t) => t.type === "function")
      .map((t) => t.function.name);
    for (const n of [
      "graph_query",
      "graph_path",
      "graph_explain",
      "graph_god_nodes",
      "graph_affected",
    ]) {
      expect(names).toContain(n);
    }
  });

  test("read guard tracks recent files", () => {
    noteFileRead("lib/main.dart");
    expect(wasRecentlyRead("lib/main.dart")).toBe(true);
    expect(readGuardHint("lib/main.dart")).toContain("already read");
    expect(readGuardHint("lib/other.dart")).toBeNull();
  });

  test("graphify enabled by default", () => {
    expect(isGraphifyEnabled()).toBe(true);
  });
});
