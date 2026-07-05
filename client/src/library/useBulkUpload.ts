import { useCallback, useEffect, useRef, useState } from "react";
import { runWithConcurrency, createSemaphore } from "@/library/uploadQueue";
import { uploadDoc, type Doc } from "@/api/client";
import { newId } from "@/lib/uuid";

/** AD-L4: cap concurrent `POST /api/docs` in flight for one batch. */
export const UPLOAD_CONCURRENCY = 4;

/** An optimistic row: not yet a stored `CollectionRow`, so it carries no
 *  `doc_id`/`order`/`folder_id`/`trashed` — those would be fabricated. */
export interface PendingUpload {
  tempId: string;
  filename: string;
}

interface QueuedFile extends PendingUpload {
  file: File;
}

interface UseBulkUploadOptions {
  /** Fires once per file whose `POST /api/docs` resolves. */
  onResolved: (doc: Doc) => void;
  /** Fires exactly once after every upload in a batch has settled, with the
   *  `doc_id`s that resolved in THIS batch (Story 6.5: the caller scopes the
   *  enrich-skipped notice to them). */
  onBatchSettled: (resolvedDocIds: string[]) => void;
  /** Fires once per batch, only when at least one file failed to store. */
  onFailed: (count: number) => void;
}

/**
 * Owns the in-flight bulk-upload machine: pushes an optimistic row per file,
 * drives them through the concurrency-capped pool, and reconciles each
 * outcome via callbacks. Decoupled from `LibraryPage`'s authoritative
 * `library` state (AD-9: this hook never imports it).
 */
export function useBulkUpload({ onResolved, onBatchSettled, onFailed }: UseBulkUploadOptions) {
  const [pending, setPending] = useState<PendingUpload[]>([]);
  const mountedRef = useRef(true);
  // One semaphore for the hook's whole lifetime: `runWithConcurrency`'s cap
  // only holds within a single `uploadFiles()` call, so two overlapping
  // batches (e.g. a drop while a previous browse is still uploading) would
  // otherwise each get their own 4 slots. This makes the cap global.
  const semaphoreRef = useRef(createSemaphore(UPLOAD_CONCURRENCY));

  useEffect(() => {
    // StrictMode dev double-invokes effects (mount, cleanup, re-mount); reset
    // to true on setup, not just via the `useRef` initializer, or the fake
    // cleanup permanently latches this false and silently drops every
    // settled upload.
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const uploadFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      const queued: QueuedFile[] = files.map((file) => ({
        tempId: newId(),
        filename: file.name,
        file,
      }));

      setPending((prev) => [...queued.map(({ tempId, filename }) => ({ tempId, filename })), ...prev]);

      let failedCount = 0;
      const resolvedDocIds: string[] = [];
      void runWithConcurrency(queued, UPLOAD_CONCURRENCY, async (item) => {
        await semaphoreRef.current.acquire();
        try {
          const doc = await uploadDoc(item.file);
          if (!mountedRef.current) return;
          resolvedDocIds.push(doc.doc_id);
          setPending((prev) => prev.filter((p) => p.tempId !== item.tempId));
          onResolved(doc);
        } catch {
          failedCount++;
          if (!mountedRef.current) return;
          setPending((prev) => prev.filter((p) => p.tempId !== item.tempId));
        } finally {
          semaphoreRef.current.release();
        }
      }).then(() => {
        if (!mountedRef.current) return;
        onBatchSettled(resolvedDocIds);
        if (failedCount > 0) onFailed(failedCount);
      });
    },
    [onResolved, onBatchSettled, onFailed],
  );

  return { pending, uploadFiles };
}
