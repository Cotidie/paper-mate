import { rowStatusClass, statusLabel, stripPdfExtension } from "@/library/row";

/**
 * An optimistic upload row (Story 6.4): rendered above the settled rows while
 * its `POST /api/docs` is in flight. Not yet a stored paper — no `doc_id`, so
 * it is inert (`aria-disabled`, no selection/open/edit), showing only the
 * filename-as-title and the "Extracting" chip.
 */
export default function PendingRow({ filename }: { filename: string }) {
  const label = statusLabel("extracting");
  const title = stripPdfExtension(filename);
  return (
    <tr aria-disabled="true" className={rowStatusClass("extracting")}>
      <td className="collection-table__title" title={title}>
        {title}
      </td>
      <td className="collection-table__authors" />
      <td className="collection-table__added" />
      <td>{label && <span className="badge-pill">{label}</span>}</td>
    </tr>
  );
}
