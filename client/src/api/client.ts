// The ONLY path from client to backend (AD-9). All types here come from the
// GENERATED OpenAPI schema — never hand-author API types (AD-3).
//
// `schema.d.ts` is produced by `npm run gen:api` from server/openapi.json.
import type { components } from "./schema";

export type HealthStatus = components["schemas"]["HealthStatus"];
export type Doc = components["schemas"]["Doc"];
export type DocPatch = components["schemas"]["DocPatch"];
/** The per-paper document-structure state (the status dot): absent | analyzing | ready. */
export type StructureStatus = Doc["structure_status"];

// Collection index (AD-L1, Story 6.2).
export type CollectionRow = components["schemas"]["CollectionRow"];
export type Folder = components["schemas"]["Folder"];
export type Library = components["schemas"]["Library"];
export type FolderCreate = components["schemas"]["FolderCreate"];
export type FolderRename = components["schemas"]["FolderRename"];
export type MoveRequest = components["schemas"]["MoveRequest"];
export type DocIdSet = components["schemas"]["DocIdSet"];

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

// Document-structure layer (AD-13, Story 10.1), generated from the Pydantic
// models — the `structure/` service imports these, never hand-authored (AD-3).
export type StructureElement = components["schemas"]["StructureElement"];
export type DocStructure = components["schemas"]["DocStructure"];

// Runtime document-structure extraction mode (the Library toggle). Generated,
// never hand-authored (AD-3).
export type StructureModeState = components["schemas"]["StructureModeState"];
export type StructureModeValue = StructureModeState["mode"];

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

/** Read the live document-structure extraction mode and any in-flight change. */
export async function fetchStructureMode(): Promise<StructureModeState> {
  const res = await fetch("/api/settings/structure-mode");
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as StructureModeState;
}

/**
 * Request a document-structure mode change. Returns immediately with the
 * transitional state (`starting`/`stopping`); the caller polls
 * `fetchStructureMode` until `transition` is `idle`, since bringing the hybrid
 * server up costs a model load.
 */
export async function setStructureMode(mode: StructureModeValue): Promise<StructureModeState> {
  const res = await fetch("/api/settings/structure-mode", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mode }),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as StructureModeState;
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
 * Partially update a document's `title`/`authors` (`PATCH /api/docs/{doc_id}`,
 * Story 6.6). Only the fields present in `patch` change; the response is the
 * full updated `Doc` so `LibraryPage` can reconcile the edited row from it.
 */
export async function patchDoc(docId: string, patch: DocPatch): Promise<Doc> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Doc;
}

/**
 * Advance a document's `last_opened` (`POST /api/docs/{doc_id}/open`, Story
 * 6.7, AC-4). A mutation, not the pure `getDoc` read. `ReaderPage` fires this
 * as a best-effort, error-swallowed side effect on open (AC-8) - a failure
 * here never gates the reader rendering the paper.
 */
export async function markDocOpened(docId: string): Promise<Doc> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/open`, { method: "POST" });
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

/**
 * Fetch a document's structure layer (`GET /api/docs/{doc_id}/structure`,
 * AD-13, Story 10.1). An imported-but-not-yet-analyzed doc (or a non-PDF)
 * returns `{ elements: [] }` (200), so the `structure/` service treats an
 * empty result as "no structure yet", not an error. Mirrors `getAnnotations`.
 */
export async function getStructure(docId: string): Promise<DocStructure> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}/structure`);
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as DocStructure;
}

/**
 * Fetch the collection index (`GET /api/library`, AD-L1/AD-L6, Story 6.3).
 * The Library route's `CollectionTable` calls this on mount to render the
 * display cache in one read.
 */
export async function getLibrary(): Promise<Library> {
  const res = await fetch("/api/library");
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Library;
}

/**
 * Create a folder (`POST /api/library/folders`, Story 7.1), optionally
 * nested under `parentId`. `FolderPanel`'s `useFolders` inserts the returned
 * `Folder` into `library.folders` optimistically-reconciled.
 */
export async function createFolder(name: string, parentId: string | null): Promise<Folder> {
  const body: FolderCreate = { name, parent_id: parentId };
  const res = await fetch("/api/library/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Folder;
}

/**
 * Rename a folder (`PATCH /api/library/folders/{folder_id}`, Story 7.1).
 * Membership is keyed by id, so this never orphans a paper.
 */
export async function renameFolder(id: string, name: string): Promise<Folder> {
  const body: FolderRename = { name };
  const res = await fetch(`/api/library/folders/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Folder;
}

/**
 * Delete a folder and its whole subtree (`DELETE /api/library/folders/{folder_id}`,
 * Story 7.1). The response is the whole updated `Library` (re-homed papers +
 * surviving folders) so the caller reconciles both from one round-trip; no
 * paper is ever deleted.
 */
export async function deleteFolder(id: string): Promise<Library> {
  const res = await fetch(`/api/library/folders/${encodeURIComponent(id)}`, { method: "DELETE" });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Library;
}

/**
 * Move a set of papers to a folder (`POST /api/library/move`, Story 7.2,
 * AD-L6). `folderId: null` clears membership (Uncategorized); a move
 * replaces any prior folder. The set-based `{doc_ids}` shape is reused as-is
 * by Story 7.3's batch move - a single-paper move is just a one-element array.
 */
export async function movePapers(docIds: string[], folderId: string | null): Promise<Library> {
  const body: MoveRequest = { doc_ids: docIds, folder_id: folderId };
  const res = await fetch("/api/library/move", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Library;
}

/**
 * Soft-delete a set of papers to Trash (`POST /api/library/trash`, Story 7.5
 * AC-1, AD-L6). `folder_id`/`order`/annotations are untouched; the papers
 * leave the current view and surface only in the Trash lens.
 */
export async function trashPapers(docIds: string[]): Promise<Library> {
  const body: DocIdSet = { doc_ids: docIds };
  const res = await fetch("/api/library/trash", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Library;
}

/**
 * Restore a set of trashed papers (`POST /api/library/restore`, Story 7.5
 * AC-3, AD-L6). Returns each to its retained `folder_id` (Uncategorized if
 * that folder no longer exists).
 */
export async function restorePapers(docIds: string[]): Promise<Library> {
  const body: DocIdSet = { doc_ids: docIds };
  const res = await fetch("/api/library/restore", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Library;
}

/**
 * Star a set of papers (`POST /api/library/star`, Story 7.8 AC-1, AD-L6).
 * `folder_id`/`order`/`trashed` and annotations are untouched.
 */
export async function starPapers(docIds: string[]): Promise<Library> {
  const body: DocIdSet = { doc_ids: docIds };
  const res = await fetch("/api/library/star", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Library;
}

/**
 * Unstar a set of papers (`POST /api/library/unstar`, Story 7.8 AC-1, AD-L6).
 */
export async function unstarPapers(docIds: string[]): Promise<Library> {
  const body: DocIdSet = { doc_ids: docIds };
  const res = await fetch("/api/library/unstar", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Library;
}

/**
 * Permanently delete a document (`DELETE /api/docs/{doc_id}`, Story 7.5 AC-4,
 * AL-5.3). Removes the whole `library/{doc_id}/` dir (source PDF +
 * annotations + meta) and its `library.json` entry. Manual only, no undo.
 */
export async function purgeDoc(docId: string): Promise<Library> {
  const res = await fetch(`/api/docs/${encodeURIComponent(docId)}`, { method: "DELETE" });
  if (!res.ok) throw await envelopeError(res);
  return (await res.json()) as Library;
}
