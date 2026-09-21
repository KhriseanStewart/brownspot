/** Session-scoped set of files already read — steer the agent away from re-reads. */
const recent = new Map<string, number>();
const MAX = 40;

export function noteFileRead(path: string): void {
  recent.set(path, Date.now());
  if (recent.size > MAX) {
    const oldest = [...recent.entries()].sort((a, b) => a[1] - b[1])[0];
    if (oldest) recent.delete(oldest[0]);
  }
}

export function wasRecentlyRead(path: string): boolean {
  return recent.has(path);
}

export function recentReadsList(): string[] {
  return [...recent.keys()];
}

export function readGuardHint(path: string): string | null {
  if (!wasRecentlyRead(path)) return null;
  return (
    `Note: ${path} was already read this session. Prefer graph_query / graph_explain / graph_path ` +
    `or use the content already in conversation instead of reading it again.`
  );
}
