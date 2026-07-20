import type { StructureStatus } from "@/api/client";
import "./StructureStatusDot.css";

/**
 * `{component.structure-status-dot}` — a small persistent circle at the start of
 * a paper's title (Library) and trailing the Reader top-bar filename, showing
 * its document-structure (opendataloader-pdf) state at a glance:
 *
 * - `absent`  → grey (steady): not analyzed / no structure yet.
 * - `analyzing` → amber (pulsing): the extraction pass is running right now.
 * - `ready`   → green (steady): analyzed, structure available.
 *
 * The amber pulse is the only motion, and only under `prefers-reduced-motion:
 * no-preference` (it holds static amber otherwise). Labeled for assistive tech
 * but not a live region (many rows carry one). Copy contains no em-dash and
 * never names the extractor.
 */
const LABEL: Record<StructureStatus, string> = {
  absent: "Not analyzed",
  analyzing: "Analyzing document structure",
  ready: "Structure analyzed",
};

export default function StructureStatusDot({
  status,
  className,
}: {
  status: StructureStatus;
  className?: string;
}) {
  return (
    <span
      className={`structure-dot${className ? ` ${className}` : ""}`}
      data-status={status}
      data-testid="structure-status-dot"
      role="img"
      aria-label={LABEL[status]}
      title={LABEL[status]}
    />
  );
}
