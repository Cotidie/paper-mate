// The ONLY path from client to backend (AD-9). All types here come from the
// GENERATED OpenAPI schema — never hand-author API types (AD-3).
//
// `schema.d.ts` is produced by `npm run gen:api` from server/openapi.json.
import type { components } from "./schema";

export type HealthStatus = components["schemas"]["HealthStatus"];

/** Fetch backend liveness. Same-origin in prod; proxied to FastAPI in dev. */
export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch("/api/health");
  if (!res.ok) {
    // Single error envelope: { detail: string } (FastAPI default).
    const body = (await res.json().catch(() => ({}))) as { detail?: string };
    throw new Error(body.detail ?? `Request failed: ${res.status}`);
  }
  return (await res.json()) as HealthStatus;
}
