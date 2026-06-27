// The ONLY path from client to backend (AD-9). All types here come from the
// GENERATED OpenAPI schema — never hand-author API types (AD-3).
//
// `schema.d.ts` is produced by `npm run gen:api` from server/openapi.json.
import type { components } from "./schema";

export type HealthStatus = components["schemas"]["HealthStatus"];
export type Doc = components["schemas"]["Doc"];

/** Surface the single `{ detail }` error envelope (FastAPI default) as an Error. */
async function envelopeError(res: Response): Promise<Error> {
  const body = (await res.json().catch(() => ({}))) as { detail?: string };
  return new Error(body.detail ?? `Request failed: ${res.status}`);
}

/** Fetch backend liveness. Same-origin in prod; proxied to FastAPI in dev. */
export async function fetchHealth(): Promise<HealthStatus> {
  const res = await fetch("/api/health");
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as HealthStatus;
}

/** Import a PDF from disk. The backend hashes, stores, and returns its `Doc`. */
export async function uploadDoc(file: File): Promise<Doc> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/docs", { method: "POST", body: form });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Doc;
}
