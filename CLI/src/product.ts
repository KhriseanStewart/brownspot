/**
 * Public production defaults — safe to ship inside the binary.
 * Never put AGENT_API_KEY / CLERK_SECRET_KEY here.
 */
export const PRODUCT = {
  name: "BrownSpot",
  bin: "dotstart",
  clerkOAuthClientId: "ZUsZKrqXcirFkQqM",
  clerkFrontendApi: "https://clerk.brownspot.terobytez.com",
  apiUrl: "https://api.brownspot.terobytez.com",
  defaultModel: "anthropic/claude-sonnet-5",
  oauthCallbackPort: 8788,
  githubRepo: "KhriseanStewart/brownspot",
} as const;
