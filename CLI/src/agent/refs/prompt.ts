import type { RetrievedChunk } from "./types.ts";
import { packChunks } from "./search.ts";
import { REF_CONTEXT_BUDGET } from "../../config.ts";

/** Compact system note injected into coding turns. */
export function formatRefsSystemNote(chunks: RetrievedChunk[]): string {
  const packed = packChunks(chunks, REF_CONTEXT_BUDGET);
  if (!packed.length) return "";

  const lines: string[] = [
    "Reference / active project context (style & structure teachers + current project). Prefer matching these patterns when coding. cwd is the active workspace; refs are teachers only.",
    "",
  ];
  for (const c of packed) {
    const role = c.project_role === "active" ? "active" : "ref";
    const title = c.title || c.path || c.kind;
    lines.push(`[${role}:${c.slug}] ${title}${c.path ? ` (${c.path})` : ""}`);
    lines.push(c.content.trim());
    lines.push("");
  }
  return lines.join("\n").trim();
}
