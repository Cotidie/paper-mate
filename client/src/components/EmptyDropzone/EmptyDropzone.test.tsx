import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import EmptyDropzone from "@/components/EmptyDropzone/EmptyDropzone";

afterEach(cleanup);

function pdfFile(name: string) {
  return new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], name, { type: "application/pdf" });
}

describe("EmptyDropzone (multi-file, Story 6.4)", () => {
  it("hands up every dropped file", () => {
    const onFiles = vi.fn();
    render(<EmptyDropzone onFiles={onFiles} />);

    const files = [pdfFile("a.pdf"), pdfFile("b.pdf")];
    fireEvent.drop(screen.getByTestId("empty-dropzone"), {
      dataTransfer: { files },
    });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toHaveLength(2);
  });

  it("hands up every picked file via the browse input", () => {
    const onFiles = vi.fn();
    render(<EmptyDropzone onFiles={onFiles} />);

    const files = [pdfFile("a.pdf"), pdfFile("b.pdf")];
    fireEvent.change(screen.getByTestId("dropzone-input"), { target: { files } });

    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0]).toHaveLength(2);
  });

  it("opens the file input when the browse button is clicked", () => {
    render(<EmptyDropzone onFiles={vi.fn()} />);
    const input = screen.getByTestId("dropzone-input") as HTMLInputElement;
    const clickSpy = vi.spyOn(input, "click");

    fireEvent.click(screen.getByRole("button", { name: /browse/i }));

    expect(clickSpy).toHaveBeenCalledTimes(1);
  });

  it("toggles the drag-over class on dragover/dragleave", () => {
    render(<EmptyDropzone onFiles={vi.fn()} />);
    const zone = screen.getByTestId("empty-dropzone");

    expect(zone.className).not.toContain("dropzone--over");
    fireEvent.dragOver(zone);
    expect(zone.className).toContain("dropzone--over");
    fireEvent.dragLeave(zone);
    expect(zone.className).not.toContain("dropzone--over");
  });

  it("ignores drops and picks while disabled", () => {
    const onFiles = vi.fn();
    render(<EmptyDropzone onFiles={onFiles} disabled />);

    fireEvent.drop(screen.getByTestId("empty-dropzone"), {
      dataTransfer: { files: [pdfFile("a.pdf")] },
    });
    expect(onFiles).not.toHaveBeenCalled();
    expect((screen.getByRole("button", { name: /browse/i }) as HTMLButtonElement).disabled).toBe(true);
  });
});
