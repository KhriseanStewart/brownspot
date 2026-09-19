import { createHash } from "node:crypto";

/** Stable SHA-256 hex of UTF-8 text (or bytes). */
export function contentHash(input: string | Uint8Array): string {
  const h = createHash("sha256");
  h.update(typeof input === "string" ? input : Buffer.from(input));
  return h.digest("hex");
}

/** Combine file relative-path + content hashes into one tree hash. */
export function combineHashes(parts: string[]): string {
  const sorted = [...parts].sort();
  return contentHash(sorted.join("\n"));
}
