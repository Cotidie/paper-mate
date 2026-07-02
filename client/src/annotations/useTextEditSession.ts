// useTextEditSession — text-edit session coalescing (Story 3.2, AC-4:
// extracted from AnnotationLayer.tsx, Story 5.3). A memo or comment textarea
// editing session (focus→blur) must land as ONE undo step, not one per
// keystroke. On focus: pause the temporal store and save the pre-session
// annotations Map. On blur: resume + push the pre-session snapshot to
// pastStates so one undo returns to the state before the editing session
// started. If nothing changed (no keystrokes), the Map ref is unchanged and
// the push is skipped.

import { useRef } from "react";
import { useAnnotationStore } from "@/store";
import type { Annotation } from "@/api/client";

export function useTextEditSession() {
  const textSessionRef = useRef<Map<string, Annotation> | null>(null);

  const onTextFocus = () => {
    textSessionRef.current = useAnnotationStore.getState().annotations;
    useAnnotationStore.temporal.getState().pause();
  };

  const onTextBlur = () => {
    useAnnotationStore.temporal.getState().resume();
    const pre = textSessionRef.current;
    textSessionRef.current = null;
    if (!pre) return;
    const current = useAnnotationStore.getState().annotations;
    if (current === pre) return; // nothing changed, skip
    const { pastStates } = useAnnotationStore.temporal.getState();
    useAnnotationStore.temporal.setState({
      pastStates: [...pastStates.slice(-99), { annotations: pre }],
      futureStates: [],
    });
  };

  return { onTextFocus, onTextBlur };
}
