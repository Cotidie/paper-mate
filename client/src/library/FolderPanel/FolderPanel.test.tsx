import { useState } from "react";
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";
import FolderPanel from "@/library/FolderPanel/FolderPanel";
import type { FolderSelection } from "@/library/folderFilter";
import * as api from "@/api/client";

afterEach(() => {
  cleanup();
});
beforeEach(() => {
  vi.restoreAllMocks();
});

function folder(id: string, name: string, parent_id: string | null = null): api.Folder {
  return { id, name, parent_id };
}

/** A thin state-owning harness mirroring how `LibraryPage` wires
 *  `useCollection`'s `setLibrary` down into `FolderPanel`. */
function Harness({
  initialFolders,
  onToast = () => {},
  initialSelection = { kind: "all" },
  onSelect,
  onDropMove = () => {},
}: {
  initialFolders: api.Folder[];
  onToast?: (message: string, variant: "error" | "info") => void;
  initialSelection?: FolderSelection;
  onSelect?: (selection: FolderSelection) => void;
  onDropMove?: (docIds: string[], folderId: string | null) => void;
}) {
  const [library, setLibrary] = useState<api.Library | null>({ papers: [], folders: initialFolders });
  const [selection, setSelection] = useState<FolderSelection>(initialSelection);
  return (
    <FolderPanel
      folders={library?.folders ?? []}
      setLibrary={setLibrary}
      onToast={onToast}
      version="1.2.3"
      selection={selection}
      onSelect={(s) => {
        setSelection(s);
        onSelect?.(s);
      }}
      onDropMove={onDropMove}
    />
  );
}

describe("FolderPanel tree rendering", () => {
  it("renders All + Uncategorized plus a nested tree from a flat Folder[]", () => {
    render(
      <Harness
        initialFolders={[folder("root", "Root Folder"), folder("child", "Child Folder", "root")]}
      />,
    );
    expect(screen.getByText("All")).toBeTruthy();
    expect(screen.getByText("Uncategorized")).toBeTruthy();
    expect(screen.getByText("Root Folder")).toBeTruthy();
    expect(screen.getByText("Child Folder")).toBeTruthy();
  });

  it("still renders an empty folder (no children, no papers)", () => {
    render(<Harness initialFolders={[folder("empty", "Empty Folder")]} />);
    expect(screen.getByText("Empty Folder")).toBeTruthy();
  });

  it("renders the fixed Library section (All, Recent, Uncategorized, Trash) above a divider from the Folder section", () => {
    render(<Harness initialFolders={[]} />);
    expect(screen.getByText("All")).toBeTruthy();
    expect(screen.getByText("Recent")).toBeTruthy();
    expect(screen.getByText("Uncategorized")).toBeTruthy();
    expect(screen.getByText("Trash")).toBeTruthy();
    expect(screen.getByText("Folder")).toBeTruthy();
  });

  it("shows the app version pinned in the panel", () => {
    render(<Harness initialFolders={[]} />);
    expect(screen.getByTestId("library-version").textContent).toBe("v1.2.3");
  });
});

describe("Create folder (AC-1)", () => {
  it("creates a root folder via the new-folder control and reflects the returned Folder", async () => {
    const created = folder("new-id", "Fresh Folder");
    const createFolder = vi.spyOn(api, "createFolder").mockResolvedValue(created);
    render(<Harness initialFolders={[]} />);

    fireEvent.click(screen.getByLabelText("New folder"));
    const input = screen.getByPlaceholderText("New folder");
    fireEvent.change(input, { target: { value: "Fresh Folder" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(createFolder).toHaveBeenCalledWith("Fresh Folder", null);
    await waitFor(() => expect(screen.getByText("Fresh Folder")).toBeTruthy());
  });

  it("creates a subfolder nested under an existing folder", async () => {
    const created = folder("child-id", "New Child", "root");
    const createFolder = vi.spyOn(api, "createFolder").mockResolvedValue(created);
    render(<Harness initialFolders={[folder("root", "Root Folder")]} />);

    fireEvent.click(screen.getByLabelText("Add subfolder to Root Folder"));
    const input = screen.getByPlaceholderText("New folder");
    fireEvent.change(input, { target: { value: "New Child" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(createFolder).toHaveBeenCalledWith("New Child", "root");
    await waitFor(() => expect(screen.getByText("New Child")).toBeTruthy());
  });

  it("Esc cancels a new-folder draft without calling the api", () => {
    const createFolder = vi.spyOn(api, "createFolder");
    render(<Harness initialFolders={[]} />);

    fireEvent.click(screen.getByLabelText("New folder"));
    const input = screen.getByPlaceholderText("New folder");
    fireEvent.change(input, { target: { value: "Abandoned" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByPlaceholderText("New folder")).toBeNull();
    expect(createFolder).not.toHaveBeenCalled();
  });

  it("a blank commit (blur with empty text) cancels instead of calling the api", () => {
    const createFolder = vi.spyOn(api, "createFolder");
    render(<Harness initialFolders={[]} />);

    fireEvent.click(screen.getByLabelText("New folder"));
    const input = screen.getByPlaceholderText("New folder");
    fireEvent.blur(input);

    expect(createFolder).not.toHaveBeenCalled();
  });

  it("a create rejection after unmount does not call onToast (Codex review)", async () => {
    let rejectCreate: (err: Error) => void = () => {};
    vi.spyOn(api, "createFolder").mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectCreate = reject;
      }),
    );
    const onToast = vi.fn();
    const { unmount } = render(<Harness initialFolders={[]} onToast={onToast} />);

    fireEvent.click(screen.getByLabelText("New folder"));
    fireEvent.change(screen.getByPlaceholderText("New folder"), { target: { value: "Doomed" } });
    fireEvent.keyDown(screen.getByPlaceholderText("New folder"), { key: "Enter" });

    unmount();
    rejectCreate(new Error("boom"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onToast).not.toHaveBeenCalled();
  });
});

describe("Rename folder (AC-2)", () => {
  it("renames optimistically, calls renameFolder, and reconciles on the resolved Folder", async () => {
    let resolveRename: (f: api.Folder) => void = () => {};
    const renameFolder = vi.spyOn(api, "renameFolder").mockReturnValue(
      new Promise((resolve) => {
        resolveRename = resolve;
      }),
    );
    render(<Harness initialFolders={[folder("f1", "Original Name")]} />);

    fireEvent.click(screen.getByLabelText("Rename Original Name"));
    const input = screen.getByDisplayValue("Original Name");
    fireEvent.change(input, { target: { value: "Renamed" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Optimistic: the new name shows before the request resolves.
    expect(screen.getByText("Renamed")).toBeTruthy();
    expect(renameFolder).toHaveBeenCalledWith("f1", "Renamed");

    resolveRename(folder("f1", "Renamed"));
    await waitFor(() => expect(screen.getByText("Renamed")).toBeTruthy());
  });

  it("reverts and toasts on a failed rename", async () => {
    vi.spyOn(api, "renameFolder").mockRejectedValue(new Error("boom"));
    const onToast = vi.fn();
    render(<Harness initialFolders={[folder("f1", "Original Name")]} onToast={onToast} />);

    fireEvent.click(screen.getByLabelText("Rename Original Name"));
    const input = screen.getByDisplayValue("Original Name");
    fireEvent.change(input, { target: { value: "Will Fail" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(screen.getByText("Will Fail")).toBeTruthy(); // optimistic
    await waitFor(() => expect(screen.getByText("Original Name")).toBeTruthy());
    expect(onToast).toHaveBeenCalledWith("Couldn't rename that folder.", "error");
  });

  it("Esc cancels a rename in progress without calling the api", () => {
    const renameFolder = vi.spyOn(api, "renameFolder");
    render(<Harness initialFolders={[folder("f1", "Original Name")]} />);

    fireEvent.click(screen.getByLabelText("Rename Original Name"));
    const input = screen.getByDisplayValue("Original Name");
    fireEvent.change(input, { target: { value: "Should Not Save" } });
    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.getByText("Original Name")).toBeTruthy();
    expect(renameFolder).not.toHaveBeenCalled();
  });
});

describe("Delete folder (AC-3, AC-7)", () => {
  it("opens an Esc-dismissable confirm and does not call deleteFolder on Esc", () => {
    const deleteFolder = vi.spyOn(api, "deleteFolder");
    render(<Harness initialFolders={[folder("f1", "Doomed")]} />);

    fireEvent.click(screen.getByLabelText("Delete Doomed"));
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/re-home|move to Uncategorized/i)).toBeTruthy();

    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(deleteFolder).not.toHaveBeenCalled();
    expect(screen.getByText("Doomed")).toBeTruthy(); // never removed
  });

  it("calls deleteFolder only on explicit confirm, and applies the returned Library", async () => {
    const rehomedLibrary: api.Library = { papers: [], folders: [] };
    const deleteFolder = vi.spyOn(api, "deleteFolder").mockResolvedValue(rehomedLibrary);
    render(<Harness initialFolders={[folder("f1", "Doomed")]} />);

    fireEvent.click(screen.getByLabelText("Delete Doomed"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    expect(deleteFolder).toHaveBeenCalledWith("f1");
    await waitFor(() => expect(screen.queryByText("Doomed")).toBeNull());
  });

  it("a stale delete response arriving after a newer create does not drop the newly created folder (Codex review)", async () => {
    let resolveDelete: (lib: api.Library) => void = () => {};
    vi.spyOn(api, "deleteFolder").mockReturnValue(
      new Promise((resolve) => {
        resolveDelete = resolve;
      }),
    );
    const created = folder("fresh-id", "Fresh");
    vi.spyOn(api, "createFolder").mockResolvedValue(created);
    render(<Harness initialFolders={[folder("old-id", "Old")]} />);

    // Issue the delete first (older op), leave it unresolved.
    fireEvent.click(screen.getByLabelText("Delete Old"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    // Issue a create second (newer op); it resolves immediately.
    fireEvent.click(screen.getByLabelText("New folder"));
    fireEvent.change(screen.getByPlaceholderText("New folder"), { target: { value: "Fresh" } });
    fireEvent.keyDown(screen.getByPlaceholderText("New folder"), { key: "Enter" });
    await waitFor(() => expect(screen.getByText("Fresh")).toBeTruthy());

    // The older delete's response finally lands, with a stale full-library
    // snapshot that predates the create. It must be dropped, not wipe "Fresh".
    resolveDelete({ papers: [], folders: [] });
    await Promise.resolve();
    await Promise.resolve();
    expect(screen.getByText("Fresh")).toBeTruthy();
  });

  it("a delete rejection after unmount does not call onToast (Codex review)", async () => {
    let rejectDelete: (err: Error) => void = () => {};
    vi.spyOn(api, "deleteFolder").mockReturnValue(
      new Promise((_resolve, reject) => {
        rejectDelete = reject;
      }),
    );
    const onToast = vi.fn();
    const { unmount } = render(
      <Harness initialFolders={[folder("f1", "Doomed")]} onToast={onToast} />,
    );

    fireEvent.click(screen.getByLabelText("Delete Doomed"));
    fireEvent.click(screen.getByRole("button", { name: "Delete" }));

    unmount();
    rejectDelete(new Error("boom"));
    await Promise.resolve();
    await Promise.resolve();
    expect(onToast).not.toHaveBeenCalled();
  });
});

describe("Hover hint tooltips on folder actions", () => {
  it("gives each per-folder action button a native title tooltip", () => {
    render(<Harness initialFolders={[folder("f1", "A Folder")]} />);
    expect(screen.getByLabelText("Rename A Folder").getAttribute("title")).toBe("Rename");
    expect(screen.getByLabelText("Add subfolder to A Folder").getAttribute("title")).toBe(
      "Add subfolder",
    );
    expect(screen.getByLabelText("Delete A Folder").getAttribute("title")).toBe("Delete");
  });
});

describe("Keyboard operability", () => {
  it("the new-folder and per-folder action buttons are real, focusable buttons", () => {
    render(<Harness initialFolders={[folder("f1", "A Folder")]} />);
    const newFolderButton = screen.getByLabelText("New folder");
    newFolderButton.focus();
    expect(document.activeElement).toBe(newFolderButton);

    const renameButton = screen.getByLabelText("Rename A Folder");
    renameButton.focus();
    expect(document.activeElement).toBe(renameButton);
  });
});

describe("Folder selection filter (Story 7.2, AC-1, AC-2, AC-5)", () => {
  it("All is active by default (resting default, unchanged from 7.1)", () => {
    render(<Harness initialFolders={[]} />);
    expect(screen.getByText("All").closest("button")?.className).toContain(
      "library-folder-panel__item--active",
    );
  });

  it("clicking All calls onSelect with { kind: 'all' }", () => {
    const onSelect = vi.fn();
    render(
      <Harness initialFolders={[]} initialSelection={{ kind: "uncategorized" }} onSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText("All"));
    expect(onSelect).toHaveBeenCalledWith({ kind: "all" });
  });

  it("clicking Uncategorized calls onSelect and highlights it", () => {
    const onSelect = vi.fn();
    render(<Harness initialFolders={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Uncategorized"));
    expect(onSelect).toHaveBeenCalledWith({ kind: "uncategorized" });
    expect(screen.getByText("Uncategorized").closest("button")?.className).toContain(
      "library-folder-panel__item--active",
    );
    expect(screen.getByText("All").closest("button")?.className).not.toContain(
      "library-folder-panel__item--active",
    );
  });

  it("clicking a folder calls onSelect with its id and highlights the row", () => {
    const onSelect = vi.fn();
    render(<Harness initialFolders={[folder("f1", "A Folder")]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("A Folder"));
    expect(onSelect).toHaveBeenCalledWith({ kind: "folder", id: "f1" });
    expect(screen.getByText("A Folder").closest("li")?.className).toContain("folder-panel__row--active");
  });

  it("clicking a rename action does NOT change the selection", () => {
    const onSelect = vi.fn();
    render(<Harness initialFolders={[folder("f1", "A Folder")]} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("Rename A Folder"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking an add-subfolder action does NOT change the selection", () => {
    const onSelect = vi.fn();
    render(<Harness initialFolders={[folder("f1", "A Folder")]} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("Add subfolder to A Folder"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("clicking a delete action does NOT change the selection", () => {
    const onSelect = vi.fn();
    render(<Harness initialFolders={[folder("f1", "A Folder")]} onSelect={onSelect} />);
    fireEvent.click(screen.getByLabelText("Delete A Folder"));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("Recent and Trash remain inert (no click handler, not selectable)", () => {
    const onSelect = vi.fn();
    render(<Harness initialFolders={[]} onSelect={onSelect} />);
    fireEvent.click(screen.getByText("Recent"));
    fireEvent.click(screen.getByText("Trash"));
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByText("Recent").closest("button")).toBeNull();
    expect(screen.getByText("Trash").closest("button")).toBeNull();
  });

  it("the All/Uncategorized/folder entries are real focusable buttons with Enter activation", () => {
    const onSelect = vi.fn();
    render(<Harness initialFolders={[folder("f1", "A Folder")]} onSelect={onSelect} />);

    const folderButton = screen.getByText("A Folder").closest("button")!;
    folderButton.focus();
    expect(document.activeElement).toBe(folderButton);
    fireEvent.keyDown(folderButton, { key: "Enter" });
    fireEvent.click(folderButton); // jsdom keyDown doesn't auto-activate; assert real button semantics
    expect(onSelect).toHaveBeenCalledWith({ kind: "folder", id: "f1" });
  });
});
