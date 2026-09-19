#!/usr/bin/env bun
import { API_HOST, API_PORT } from "../config.ts";
import { api } from "./routes.ts";

console.log(`BrownSpot API listening on http://${API_HOST}:${API_PORT}`);
Bun.serve({
  hostname: API_HOST,
  port: API_PORT,
  fetch: api.fetch,
});
