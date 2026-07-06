import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import MoveMenu from "./MoveMenu";
import type { Folder } from "@/api/client";

afterEach(cleanup);

const folders: Folder[] = [{ id: "f1", name: "Folder A", parent_id: null }];

describe("MoveMenu", () => {
  it("is closed by default", () => {
    render(<MoveMenu folders={folders} onMove={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the popover on click, listing Uncategorized and every folder", () => {
    render(<MoveMenu folders={folders} onMove={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to folder" }));
    expect(screen.getByRole("menuitem", { name: "Uncategorized" })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Folder A" })).toBeTruthy();
  });

  it("calls onMove with the folder id and closes when a folder is clicked", () => {
    const onMove = vi.fn();
    render(<MoveMenu folders={folders} onMove={onMove} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to folder" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Folder A" }));
    expect(onMove).toHaveBeenCalledWith("f1");
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("calls onMove with null when Uncategorized is clicked", () => {
    const onMove = vi.fn();
    render(<MoveMenu folders={folders} onMove={onMove} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to folder" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Uncategorized" }));
    expect(onMove).toHaveBeenCalledWith(null);
  });

  it("Escape closes the popover even while focus stays on the trigger button (code-review fix: the button's own keydown handler used to swallow every key, including Escape, before it could reach the document-level dismiss listener)", () => {
    render(<MoveMenu folders={folders} onMove={vi.fn()} />);
    const button = screen.getByRole("button", { name: "Move to folder" });
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(button, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside pointerdown", () => {
    render(<MoveMenu folders={folders} onMove={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "Move to folder" }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("is disabled when disabled is passed", () => {
    render(<MoveMenu folders={folders} onMove={vi.fn()} disabled />);
    expect((screen.getByRole("button", { name: "Move to folder" }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });
});
