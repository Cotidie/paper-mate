import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import {
  createFolder as apiCreateFolder,
  deleteFolder as apiDeleteFolder,
  renameFolder as apiRenameFolder,
  type Folder,
  type Library,
} from "@/api/client";

interface UseFoldersOptions {
  /** The current folder tree (to read a folder's prior name before an
   *  optimistic rename overwrite). */
  folders: Folder[];
  /** Reconcile the collection (owned by `useCollection`). */
  setLibrary: Dispatch<SetStateAction<Library | null>>;
  /** Raise a page-level error toast when a create/rename/delete fails. */
  onToast: (message: string, variant: "error" | "info") => void;
}

/**
 * The folder CRUD lifecycle (Story 7.1): create/rename/delete against
 * `/api/library/folders`, applying each result via `setLibrary`. Rename is
 * optimistic (mirrors `useInlineEdit`): the name changes immediately and
 * reverts on failure, guarded by a per-folder monotonic sequence so a slow
 * older request can't clobber a faster newer one. Create/delete apply their
 * result only once the request resolves (no synthetic id to render early);
 * they share one monotonic `opSeqRef` (Codex review) so a stale response
 * can't apply once a newer create/delete has already been issued — delete's
 * response is a full `Library` replace, so an out-of-order-arriving stale one
 * could otherwise clobber a newer create's already-applied folder, or vice
 * versa duplicate/lose one (the same "only the latest issued call may apply"
 * rule `useCollection`'s `fetchSeqRef` already uses for `getLibrary()`).
 */
export function useFolders({ folders, setLibrary, onToast }: UseFoldersOptions) {
  const mountedRef = useRef(true);
  const renameSeqRef = useRef<Map<string, number>>(new Map());
  const opSeqRef = useRef(0);

  useEffect(() => {
    // StrictMode dev double-invokes effects; reset to true on setup, or the
    // fake cleanup permanently latches this false (Epic 6 retro lesson).
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const createFolder = useCallback(
    (name: string, parentId: string | null) => {
      const seq = ++opSeqRef.current;
      apiCreateFolder(name, parentId)
        .then((folder: Folder) => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary((prev) => (prev ? { ...prev, folders: [...prev.folders, folder] } : prev));
        })
        .catch(() => {
          if (!mountedRef.current) return;
          onToast("Couldn't create that folder.", "error");
        });
    },
    [setLibrary, onToast],
  );

  const renameFolder = useCallback(
    (id: string, name: string) => {
      const seq = (renameSeqRef.current.get(id) ?? 0) + 1;
      renameSeqRef.current.set(id, seq);
      const isLatest = () => renameSeqRef.current.get(id) === seq;
      const prior = folders.find((f) => f.id === id) ?? null;

      setLibrary((prev) =>
        prev ? { ...prev, folders: prev.folders.map((f) => (f.id === id ? { ...f, name } : f)) } : prev,
      );
      apiRenameFolder(id, name)
        .then((folder: Folder) => {
          if (!mountedRef.current || !isLatest()) return;
          setLibrary((prev) =>
            prev ? { ...prev, folders: prev.folders.map((f) => (f.id === id ? folder : f)) } : prev,
          );
        })
        .catch(() => {
          if (!mountedRef.current || !isLatest() || !prior) return;
          setLibrary((prev) =>
            prev ? { ...prev, folders: prev.folders.map((f) => (f.id === id ? prior : f)) } : prev,
          );
          onToast("Couldn't rename that folder.", "error");
        });
    },
    [folders, setLibrary, onToast],
  );

  const deleteFolder = useCallback(
    (id: string) => {
      const seq = ++opSeqRef.current;
      apiDeleteFolder(id)
        .then((library: Library) => {
          if (!mountedRef.current || seq !== opSeqRef.current) return;
          setLibrary(library);
        })
        .catch(() => {
          if (!mountedRef.current) return;
          onToast("Couldn't delete that folder.", "error");
        });
    },
    [setLibrary, onToast],
  );

  return { createFolder, renameFolder, deleteFolder };
}
