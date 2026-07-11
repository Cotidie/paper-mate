import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import TagCell from "./TagCell";

afterEach(cleanup);

/** `TagCell` only ever renders inside a `<tr>`, but a bare `<table><tbody><tr>`
 *  wrapper is enough for a real DOM `<td>` (React warns otherwise). */
function renderCell(props: Partial<React.ComponentProps<typeof TagCell>> = {}) {
  const defaults: React.ComponentProps<typeof TagCell> = {
    authors: ["Ada Lovelace", "Alan Turing"],
    editable: true,
    armed: false,
    isEditing: false,
    onStartEdit: vi.fn(),
    onArm: vi.fn(),
    onCommit: vi.fn(),
    onCancel: vi.fn(),
  };
  const merged = { ...defaults, ...props };
  render(
    <table>
      <tbody>
        <tr onClick={merged.onArm as () => void}>
          <TagCell {...merged} />
        </tr>
      </tbody>
    </table>,
  );
  return merged;
}

describe("TagCell (Story 7.11, AC-1/AC-3)", () => {
  it("renders one chip per author", () => {
    renderCell();
    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.getByText("Alan Turing")).toBeTruthy();
  });

  it("renders no chips for an empty author list", () => {
    renderCell({ authors: [] });
    expect(screen.queryAllByRole("button").length).toBe(0);
  });
});

describe("TagCell cell-arm/edit (Story 7.11, Dev Notes)", () => {
  it("an UNARMED cell background click bubbles to arm the row (not intercepted)", () => {
    const onArm = vi.fn();
    const onStartEdit = vi.fn();
    renderCell({ onArm, onStartEdit, armed: false });

    fireEvent.click(screen.getByLabelText("Edit authors"));

    expect(onArm).toHaveBeenCalledTimes(1);
    expect(onStartEdit).not.toHaveBeenCalled();
  });

  it("an ARMED cell background click opens the editor and does not re-arm", () => {
    const onArm = vi.fn();
    const onStartEdit = vi.fn();
    renderCell({ onArm, onStartEdit, armed: true });

    fireEvent.click(screen.getByLabelText("Edit authors"));

    expect(onStartEdit).toHaveBeenCalledTimes(1);
    expect(onArm).not.toHaveBeenCalled();
  });

  it("a non-editable (extracting) row renders chips as plain, non-interactive text", () => {
    renderCell({ editable: false });

    expect(screen.getByText("Ada Lovelace")).toBeTruthy();
    expect(screen.queryAllByRole("button").length).toBe(0);
  });
});

describe("TagCell editor (Story 7.11, AC-4/AC-7)", () => {
  it("floats the tag editor when isEditing while the static cell stays in place (row does not grow)", () => {
    renderCell({ isEditing: true });
    // The floating editor: an input plus each author as a removable chip.
    expect(screen.getByPlaceholderText("Add author")).toBeTruthy();
    expect(screen.getByLabelText("Remove Ada Lovelace")).toBeTruthy();
    // The static cell keeps rendering its chips underneath (no reflow), so the
    // author text is present in BOTH the cell and the editor.
    expect(screen.getAllByText("Ada Lovelace").length).toBe(2);
  });

  it("typing a name and pressing Enter adds a chip; commit (on blur) sends the full new list", () => {
    const onCommit = vi.fn();
    renderCell({ isEditing: true, onCommit });

    const input = screen.getByPlaceholderText("Add author");
    fireEvent.change(input, { target: { value: "Grace Hopper" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByText("Grace Hopper")).toBeTruthy();

    fireEvent.blur(input);
    expect(onCommit).toHaveBeenCalledWith(["Ada Lovelace", "Alan Turing", "Grace Hopper"]);
  });

  it("removing a chip drops it from the committed list", () => {
    const onCommit = vi.fn();
    renderCell({ isEditing: true, onCommit });

    fireEvent.click(screen.getByLabelText("Remove Ada Lovelace"));
    fireEvent.blur(screen.getByPlaceholderText("Add author"));

    expect(onCommit).toHaveBeenCalledWith(["Alan Turing"]);
  });

  it("Tab-focus moving from the input to a remove button does NOT commit (Codex review: remove buttons must be keyboard-reachable)", () => {
    const onCommit = vi.fn();
    renderCell({ isEditing: true, onCommit });

    const input = screen.getByPlaceholderText("Add author");
    const removeButton = screen.getByLabelText("Remove Ada Lovelace");
    fireEvent.blur(input, { relatedTarget: removeButton });

    expect(onCommit).not.toHaveBeenCalled();

    fireEvent.click(removeButton);
    fireEvent.blur(input, { relatedTarget: null });
    expect(onCommit).toHaveBeenCalledWith(["Alan Turing"]);
  });

  it("Escape cancels without committing", () => {
    const onCommit = vi.fn();
    const onCancel = vi.fn();
    renderCell({ isEditing: true, onCommit, onCancel });

    const input = screen.getByPlaceholderText("Add author");
    fireEvent.change(input, { target: { value: "Grace Hopper" } });
    fireEvent.keyDown(input, { key: "Escape" });
    // Esc unmounts via isEditing flipping false in a real parent; here we
    // simulate the resulting blur a real unmount would trigger and assert
    // the double-fire guard: cancel already fired, blur must not also commit.
    fireEvent.blur(input);

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it("blur commits an empty draft as a cleared author list", () => {
    const onCommit = vi.fn();
    renderCell({ authors: ["Ada Lovelace"], isEditing: true, onCommit });

    fireEvent.click(screen.getByLabelText("Remove Ada Lovelace"));
    fireEvent.blur(screen.getByPlaceholderText("Add author"));

    expect(onCommit).toHaveBeenCalledWith([]);
  });
});
