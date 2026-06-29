import type { ReactNode } from "react";

/**
 * `ToolFlyout` — the shared sub-toolrail shell. ONE definition of the floating
 * secondary picker that opens beside a rail button: its position (anchored to the
 * owning `.tool-rail__item` button), box style (surface, hairline, radius, shadow),
 * and vertical column layout. EVERY tool's sub-toolbar renders its controls inside
 * this — the pointer cursor/hand/box options, the Highlight color swatches, and the
 * future underline/pen/memo/comment pickers — so they all share identical placement
 * and item sizing instead of each tool re-styling its own flyout.
 *
 * Contents are tool-specific (icons vs swatches), but the shell + the 36px item
 * cells (`.tool-flyout` CSS) are uniform. Always render this inside a
 * `.tool-rail__item` wrapper so the absolute box anchors to that button.
 */
export default function ToolFlyout({
  testId,
  children,
}: {
  /** Stable test id for the flyout box (e.g. "tool-flyout", "highlight-color-flyout"). */
  testId: string;
  children: ReactNode;
}) {
  return (
    <div className="tool-flyout" role="menu" data-testid={testId}>
      {children}
    </div>
  );
}
