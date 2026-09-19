export function shellQuote(value: string): string {
  // POSIX-safe: 'foo'\''bar' for values containing single quotes
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function interpolateTemplate(
  template: string,
  params: Record<string, string>,
  defaults: Record<string, string> = {},
): string {
  let out = template.replace(/\{\{#(\w+)\}\}([\s\S]*?)\{\{\/\1\}\}/g, (_, key, inner) => {
    const v = (params[key] ?? defaults[key] ?? "").trim();
    return v && v !== "0" && v.toLowerCase() !== "false" ? inner : "";
  });
  out = out.replace(/\{\{(\w+)\}\}/g, (_, key: string) => {
    const raw = params[key] ?? defaults[key] ?? "";
    return shellQuote(String(raw));
  });
  // Clean empty quoted args that are optional (e.g. trailing '')
  out = out.replace(/ ''/g, "");
  return out.trim();
}

export const COMMAND_DEFAULTS: Record<string, Record<string, string>> = {
  "git.log": { count: "15" },
  "git.push": { remote: "origin", branch: "HEAD" },
  "git.push_upstream": { remote: "origin" },
  "gh.pr.list": { limit: "20" },
  "gh.issue.list": { limit: "20" },
  "gh.release.list": { limit: "10" },
  "gh.run.list": { limit: "10" },
  "docker.logs": { tail: "100" },
  "cf.tunnel_info": { name: "brownspot-api" },
};
