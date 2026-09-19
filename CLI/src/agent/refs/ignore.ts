import path from "node:path";

/** Directory / file name segments to skip while walking. */
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".turbo",
  ".cache",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".idea",
  ".vscode",
]);

const SECRET_BASENAME =
  /^(\.env(\..*)?|\.pem|\.key|id_rsa|id_ed25519|credentials\.json|secrets?\.(json|ya?ml|toml))$/i;

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".tar",
  ".tgz",
  ".bz2",
  ".7z",
  ".rar",
  ".woff",
  ".woff2",
  ".ttf",
  ".otf",
  ".eot",
  ".mp3",
  ".mp4",
  ".mov",
  ".avi",
  ".wav",
  ".wasm",
  ".so",
  ".dylib",
  ".dll",
  ".exe",
  ".bin",
  ".o",
  ".a",
  ".class",
  ".jar",
  ".pyc",
  ".lock",
]);

/** True if this basename or relative path segment should be skipped. */
export function shouldSkipName(name: string): boolean {
  if (!name || name === "." || name === "..") return true;
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (SECRET_BASENAME.test(name)) return true;
  return false;
}

/** True if extension looks binary / non-text. */
export function isLikelyBinaryPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXT.has(ext);
}

/**
 * Resolve `candidate` and ensure it stays under `root` (no escape).
 * Both may be absolute; returns absolute resolved path.
 */
export function resolveUnderRoot(root: string, candidate: string): string {
  const rootAbs = path.resolve(root);
  const abs = path.resolve(rootAbs, candidate);
  if (abs !== rootAbs && !abs.startsWith(rootAbs + path.sep)) {
    throw new Error(`Path escapes project root: ${candidate}`);
  }
  return abs;
}

/** Absolute local path must exist as a directory and not look like a secret dump. */
export function assertSafeProjectPath(localPath: string): string {
  const abs = path.resolve(localPath);
  if (!path.isAbsolute(abs)) {
    throw new Error(`Project path must be absolute: ${localPath}`);
  }
  const base = path.basename(abs);
  if (shouldSkipName(base) && base !== ".") {
    throw new Error(`Refusing to index path named ${base}`);
  }
  return abs;
}

export type WalkCaps = {
  maxDepth: number;
  maxFiles: number;
  maxFileBytes: number;
};

export const DEFAULT_WALK_CAPS: WalkCaps = {
  maxDepth: 6,
  maxFiles: 800,
  maxFileBytes: 120 * 1024,
};
