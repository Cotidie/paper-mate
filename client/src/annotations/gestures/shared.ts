// Shared plumbing for the per-gesture hooks (Story 5.0). Each gesture (pen, box,
// memo, …) is encapsulated as its own cohesive hook that owns its synchronous
// draft refs and binds its own document-level handlers (AP-1). They all need the
// same live, synchronously-readable context — the armed tool, the page geometry,
// the scale, and the active-tool defaults — which the component mirrors into refs
// once and threads in here, so a handler bound once on `document` never re-binds
// on every scale/tool change.

import type { RefObject } from "react";
import type { PageCardRef } from "../../anchor";
import type { Annotation } from "../../api/client";
import type { AnnotationTool } from "../../tools";
import type { MemoSize } from "../../store";

/** The live active-tool defaults a create gesture reads at commit time. `colors`
 *  is keyed per tool (each tool remembers its own last-picked color); a gesture
 *  that creates one specific type reads its own slot (e.g. `colors.pen`). */
export interface ActiveDefaults {
  colors: Record<AnnotationTool, string>;
  strokeWidth: number;
  alpha: number;
  memoSize: MemoSize;
}

/** The synchronously-readable context every gesture hook consumes. The refs are
 *  read inside document-level handlers (never written there); the store actions
 *  are stable. `enabled` is the phase gate (`phase === "ready"`). */
export interface GestureContext {
  enabled: boolean;
  docId: string;
  /** The armed annotation tool, read synchronously in handlers (null = cursor). */
  armedToolRef: RefObject<AnnotationTool | null>;
  /** Current page cards at interaction time (live geometry). */
  getPagesRef: RefObject<() => PageCardRef[]>;
  /** Current zoom scale. */
  scaleRef: RefObject<number>;
  /** The active-tool defaults a new mark lands in. */
  defaultsRef: RefObject<ActiveDefaults>;
  addAnnotation: (a: Annotation) => void;
  select: (id: string | null) => void;
}

/** Skip editable fields + buttons so the global handlers never eat a control's
 *  own keys/clicks (mirrors the Reader's hold-Space `isExempt`). Shared by every
 *  gesture hook AND the remaining document-level handlers in the component. */
export function isExempt(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName;
  return (
    tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || tag === "BUTTON" || el.isContentEditable
  );
}
