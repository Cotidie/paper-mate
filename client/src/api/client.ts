// The ONLY path from client to backend (AD-9). All types here come from the
// GENERATED OpenAPI schema — never hand-author API types (AD-3).
//
// `schema.d.ts` is produced by `npm run gen:api` from server/openapi.json.
import type { components } from "./schema";

export type HealthStatus = components["schemas"]["HealthStatus"];
export type Doc = components["schemas"]["Doc"];

// Annotation entity (AD-5), generated from the Pydantic model — the store and
// overlay import the shape from here, never hand-author it (AD-3). `Anchor` is
// the discriminated union (`anchor.kind`); the Annotated union has no named
// OpenAPI component, so it is composed here from the variant schemas.
export type Rect = components["schemas"]["Rect"];
export type Point = components["schemas"]["Point"];
export type Style = components["schemas"]["Style"];
export type TextAnchor = components["schemas"]["TextAnchor"];
export type RectAnchor = components["schemas"]["RectAnchor"];
export type PathAnchor = components["schemas"]["PathAnchor"];
export type Anchor = TextAnchor | RectAnchor | PathAnchor;
export type Annotation = components["schemas"]["Annotation"];

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

/**
 * URL of a stored document's PDF bytes (`GET /api/docs/{doc_id}/file`). The
 * `api/` module is the single owner of backend routes — the render layer takes
 * this URL and never hardcodes the path (AD-9).
 */
export function docFileUrl(docId: string): string {
  return `/api/docs/${encodeURIComponent(docId)}/file`;
}

/** Import a PDF from disk. The backend hashes, stores, and returns its `Doc`. */
export async function uploadDoc(file: File): Promise<Doc> {
  const form = new FormData();
  form.append("file", file);
  const res = await fetch("/api/docs", { method: "POST", body: form });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Doc;
}

/**
 * Fetch a document's own metadata (`GET /api/docs/{doc_id}`, Story 6.1,
 * AD-L6). The `/reader/:docId` route has only a hash id, so it loads its
 * `Doc` (filename/page_count) through this rather than an upload result.
 */
export async function getDoc(docId: string): Promise<Doc> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}`);
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Doc;
}

/**
 * Overwrite a document's full annotation set (`PUT /api/docs/{doc_id}/annotations`).
 * AR-7/H6: the autosave hook calls this single-flight, debounced, with the
 * FULL current set every time. H9: the body is the bare list; the
 * `{schema_version, annotations}` disk envelope is storage-internal.
 */
export async function putAnnotations(docId: string, annotations: Annotation[]): Promise<void> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/annotations`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(annotations),
  });
  if (!res.ok) throw await envelopeError(res);
}

/**
 * Fetch a document's saved annotation set (`GET /api/docs/{doc_id}/annotations`)
 * for hydrate-on-open (Story 3.5, AD-6). H9: the body is the bare list; an
 * imported-but-unannotated doc returns `[]` (not a 404). The store's
 * `openDoc` consumes this while the doc is still opening (ReaderPage's
 * param-driven load, Story 6.1).
 */
export async function getAnnotations(docId: string): Promise<Annotation[]> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/annotations`);
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Annotation[];
}
