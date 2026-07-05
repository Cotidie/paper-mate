import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import AddMenu from "@/library/AddMenu";

afterEach(cleanup);

describe("AddMenu", () => {
  it("is closed by default", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("opens the menu on click, with both items present", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /file upload/i })).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: /folder upload/i })).toBeTruthy();
  });

  it("calls onFileUpload and closes when File upload is clicked", () => {
    const onFileUpload = vi.fn();
    render(<AddMenu onFileUpload={onFileUpload} onFolderUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /file upload/i }));
    expect(onFileUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("calls onFolderUpload and closes when Folder upload is clicked", () => {
    const onFolderUpload = vi.fn();
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={onFolderUpload} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    fireEvent.click(screen.getByRole("menuitem", { name: /folder upload/i }));
    expect(onFolderUpload).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("closes and returns focus to the Add button on Escape", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    const button = screen.getByRole("button", { name: /add/i });
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("menu")).toBeNull();
    expect(document.activeElement).toBe(button);
  });

  it("closes on an outside pointerdown", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /add/i }));
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("toggles closed when the Add button is clicked again while open", () => {
    render(<AddMenu onFileUpload={vi.fn()} onFolderUpload={vi.fn()} />);
    const button = screen.getByRole("button", { name: /add/i });
    fireEvent.click(button);
    expect(screen.getByRole("menu")).toBeTruthy();
    fireEvent.click(button);
    expect(screen.queryByRole("menu")).toBeNull();
  });
});
