import { describe, expect, test } from "bun:test";
import { contentHash, combineHashes } from "../refs/hash.ts";
import {
  assertSafeProjectPath,
  normalizeUserPath,
  isLikelyBinaryPath,
  resolveUnderRoot,
  shouldSkipName,
} from "../refs/ignore.ts";
import { buildFtsQuery, packChunks } from "../refs/search.ts";
import { canAddReference, slugify } from "../refs/store.ts";
import { cosineSimilarity } from "../refs/embed.ts";
import type { RetrievedChunk } from "../refs/types.ts";
import { tools } from "../tools.ts";

describe("refs ignore + path safety", () => {
  test("skips node_modules .git dist secrets", () => {
    expect(shouldSkipName("node_modules")).toBe(true);
    expect(shouldSkipName(".git")).toBe(true);
    expect(shouldSkipName("dist")).toBe(true);
    expect(shouldSkipName(".env")).toBe(true);
    expect(shouldSkipName(".env.local")).toBe(true);
    expect(shouldSkipName("src")).toBe(false);
  });

  test("detects binary extensions", () => {
    expect(isLikelyBinaryPath("foo.png")).toBe(true);
    expect(isLikelyBinaryPath("lib.so")).toBe(true);
    expect(isLikelyBinaryPath("index.ts")).toBe(false);
  });

  test("resolveUnderRoot blocks escape", () => {
    expect(() => resolveUnderRoot("/tmp/proj", "../etc/passwd")).toThrow();
    expect(resolveUnderRoot("/tmp/proj", "src/a.ts")).toBe("/tmp/proj/src/a.ts");
  });


  test("normalizeUserPath strips wrapping quotes and expands ~", () => {
    expect(normalizeUserPath("'/tmp/my-app'")).toBe("/tmp/my-app");
    expect(normalizeUserPath('"/tmp/other"')).toBe("/tmp/other");
    const home = normalizeUserPath("~/Projects/demo");
    expect(home.startsWith("/")).toBe(true);
    expect(home).toContain("Projects/demo");
  });

  test("assertSafeProjectPath accepts quoted absolute paths", () => {
    expect(assertSafeProjectPath("'/tmp/quoted-app'")).toBe("/tmp/quoted-app");
  });

  test("assertSafeProjectPath normalizes absolute", () => {
    const abs = assertSafeProjectPath("/tmp/my-app");
    expect(abs).toBe("/tmp/my-app");
  });
});

describe("refs hashing", () => {
  test("contentHash is stable sha256 hex", () => {
    const a = contentHash("hello");
    const b = contentHash("hello");
    const c = contentHash("world");
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  test("combineHashes is order-independent", () => {
    expect(combineHashes(["b", "a"])).toBe(combineHashes(["a", "b"]));
  });
});

describe("refs max + slug", () => {
  test("canAddReference respects max", () => {
    expect(canAddReference(0, 3)).toBe(true);
    expect(canAddReference(2, 3)).toBe(true);
    expect(canAddReference(3, 3)).toBe(false);
  });

  test("slugify basename", () => {
    expect(slugify("/Users/me/My App!")).toBe("my-app");
  });
});

describe("refs FTS helper + pack", () => {
  test("buildFtsQuery strips websearch operators", () => {
    expect(buildFtsQuery("  foo & bar:baz!  ")).toBe("foo bar baz");
    expect(buildFtsQuery("")).toBe("");
  });

  test("packChunks respects budget", () => {
    const chunks: RetrievedChunk[] = [
      {
        id: 1,
        project_id: 1,
        snapshot_id: null,
        kind: "readme",
        path: "README.md",
        title: "README",
        content: "x".repeat(2000),
        content_hash: "a",
        metadata: {},
        slug: "demo",
        project_role: "reference",
        label: "demo",
      },
      {
        id: 2,
        project_id: 1,
        snapshot_id: null,
        kind: "file",
        path: "a.ts",
        title: "a",
        content: "y".repeat(2000),
        content_hash: "b",
        metadata: {},
        slug: "demo",
        project_role: "active",
        label: "demo",
      },
    ];
    const packed = packChunks(chunks, 2500);
    const total = packed.reduce((n, c) => n + c.content.length, 0);
    expect(total).toBeLessThanOrEqual(2500);
    expect(packed.length).toBeGreaterThan(0);
  });
});

describe("refs embeddings helpers", () => {
  test("cosineSimilarity identical vectors ~1", () => {
    expect(cosineSimilarity([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

describe("refs tools registered", () => {
  test("list + search tools exist", () => {
    const names = tools
      .filter((t) => t.type === "function")
      .map((t) => t.function.name);
    expect(names).toContain("list_reference_projects");
    expect(names).toContain("search_reference_context");
  });
});
