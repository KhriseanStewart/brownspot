import path from "node:path";

/** Directory names to skip entirely while walking (any depth). */
export const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  "coverage",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  ".cache",
  ".parcel-cache",
  ".vite",
  ".svelte-kit",
  "__pycache__",
  ".venv",
  "venv",
  "target",
  ".idea",
  ".vscode",
  ".cursor",
  ".expo",
  ".expo-shared",
  ".dart_tool",
  ".gradle",
  ".yarn",
  ".pnpm-store",
  "Pods",
  "DerivedData",
  "vendor",
  "tmp",
  "temp",
  "logs",
  ".nyc_output",
  "storybook-static",
]);

/** Exact basenames that are noise (locks, OS junk, generated maps). */
export const SKIP_FILE_BASENAMES = new Set([
  ".ds_store",
  "thumbs.db",
  "desktop.ini",
  "package-lock.json",
  "yarn.lock",
  "pnpm-lock.yaml",
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "cargo.lock",
  "poetry.lock",
  "gemfile.lock",
  "composer.lock",
  "flake.lock",
  "pdm.lock",
  "go.sum",
  ".eslintcache",
  ".prettiercache",
  "gradlew",
  "gradlew.bat",
]);

const SECRET_BASENAME =
  /^(\.env(\..*)?|\.pem|\.key|id_rsa|id_ed25519|credentials\.json|secrets?\.(json|ya?ml|toml)|google-services\.json|googleservice-info\.plist)$/i;

const BINARY_EXT = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".ico",
  ".svg", // often huge icon sets; tree + package.json already capture structure
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
  ".lockb",
  ".map",
  ".parquet",
  ".sqlite",
  ".db",
  ".psd",
  ".ai",
  ".sketch",
  ".fig",
  ".heic",
  ".avif",
  ".apk",
  ".aab",
  ".ipa",
  ".dmg",
  ".app",
]);

/** Path segment patterns (posix-style relative path) to skip. */
const SKIP_PATH_RE = [
  /(^|\/)android\/(\.gradle|build|app\/build)(\/|$)/i,
  /(^|\/)ios\/(build|pods|deriveddata)(\/|$)/i,
  /(^|\/)\.git(\/|$)/i,
  /(^|\/)node_modules(\/|$)/i,
  /(^|\/)\.expo(\/|$)/i,
  /(^|\/)__snapshots__(\/|$)/i,
  /(^|\/)__mocks__(\/|$)/i,
  /(^|\/)fixtures?\/large(\/|$)/i,
  /\.min\.(js|css)$/i,
  /\.bundle\.js$/i,
  /\.d\.ts\.map$/i,
];

/** Source extensions worth sampling when not high-value config/docs. */
export const KEEP_SOURCE_EXT =
  /\.(ts|tsx|js|jsx|mjs|cjs|py|rs|go|java|kt|kts|swift|rb|php|cs|vue|svelte)$/i;

/** True if this basename or relative path segment should be skipped. */
export function shouldSkipName(name: string): boolean {
  if (!name || name === "." || name === "..") return true;
  if (SKIP_DIR_NAMES.has(name)) return true;
  if (SECRET_BASENAME.test(name)) return true;
  if (SKIP_FILE_BASENAMES.has(name.toLowerCase())) return true;
  return false;
}

/** True if extension looks binary / non-text / asset noise. */
export function isLikelyBinaryPath(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  return BINARY_EXT.has(ext);
}

/**
 * Skip a file by relative path (posix). Use after basename checks.
 * Filters Expo/Android/iOS build trees, minified bundles, lockfiles, secrets.
 */
export function shouldSkipRelPath(relPosix: string): boolean {
  const base = path.posix.basename(relPosix).toLowerCase();
  if (SKIP_FILE_BASENAMES.has(base)) return true;
  if (SECRET_BASENAME.test(base)) return true;
  if (isLikelyBinaryPath(relPosix)) return true;
  for (const re of SKIP_PATH_RE) {
    if (re.test(relPosix)) return true;
  }
  // Skip nested generated native project clutter beyond top-level package manifests
  if (/^ios\/.+\.(pbxproj|xcworkspace|xcscheme)$/i.test(relPosix)) return true;
  if (/^android\/.*\.(iml|keystore)$/i.test(relPosix)) return true;
  return false;
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

/**
 * Normalize a path typed/pasted by a human:
 * trim, strip wrapping quotes (incl. smart quotes), expand ~, resolve absolute.
 */
export function normalizeUserPath(raw: string, cwd = process.cwd()): string {
  let s = raw.trim();
  const quotePairs: Array<[string, string]> = [
    ["'", "'"],
    ['"', '"'],
    ["\u2018", "\u2019"],
    ["\u201c", "\u201d"],
    ["`", "`"],
  ];
  for (const [open, close] of quotePairs) {
    if (s.length >= 2 && s.startsWith(open) && s.endsWith(close)) {
      s = s.slice(open.length, -close.length).trim();
      break;
    }
  }
  s = s
    .replace(/^['"`\u2018\u2019\u201c\u201d]+/, "")
    .replace(/['"`\u2018\u2019\u201c\u201d]+$/, "")
    .trim();

  if (s.startsWith("~/") || s === "~") {
    const home = process.env.HOME || process.env.USERPROFILE || "";
    s = s === "~" ? home : path.join(home, s.slice(2));
  }
  return path.resolve(cwd, s);
}

/** Absolute local path after human-input cleanup; rejects secret-like basenames. */
export function assertSafeProjectPath(localPath: string): string {
  const finalAbs = normalizeUserPath(localPath);
  if (!path.isAbsolute(finalAbs)) {
    throw new Error(`Project path must be absolute: ${localPath}`);
  }
  const base = path.basename(finalAbs);
  if (shouldSkipName(base) && base !== ".") {
    throw new Error(`Refusing to index path named ${base}`);
  }
  return finalAbs;
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
