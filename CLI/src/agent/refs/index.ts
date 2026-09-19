export { handleRefsCommand } from "./commands.ts";
export {
  runRefsStartup,
  ensureActiveProject,
  maybeReingestActive,
} from "./startup.ts";
export {
  retrieveForTurn,
  listProjectsForTool,
  searchContextForTool,
} from "./retrieve.ts";
export { searchReferenceContext, buildFtsQuery, packChunks } from "./search.ts";
export { contentHash, combineHashes } from "./hash.ts";
export {
  shouldSkipName,
  isLikelyBinaryPath,
  resolveUnderRoot,
  assertSafeProjectPath,
  DEFAULT_WALK_CAPS,
} from "./ignore.ts";
export { canAddReference, slugify } from "./store.ts";
export {
  cosineSimilarity,
  embeddingsEnabled,
  isHighValueKind,
} from "./embed.ts";
