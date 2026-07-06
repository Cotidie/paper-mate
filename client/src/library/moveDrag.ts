/**
 * The drag payload shared between a table row's `dragstart` (source) and a
 * `FolderPanel` entry's `drop` (target) for drag-to-move. A dedicated MIME
 * type (not `text/plain`) so a row drag is distinguishable from the
 * `main`-level file-drop upload dropzone, which reads `dataTransfer.files`.
 */
export const MOVE_DRAG_MIME = "application/x-papermate-move";

export function encodeDragIds(ids: string[]): string {
  return JSON.stringify(ids);
}

export function decodeDragIds(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}
